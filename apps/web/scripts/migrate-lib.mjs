// Decision logic and runner for scripts/migrate.mjs, kept free of process/fs
// side effects so apps/web/test/migrate.test.ts can drive it with a fake client.
//
// Tracking is identical to the Supabase CLI (supabase/cli pkg/migration), so
// `supabase db push` and the Supabase GitHub integration see the same history:
//   supabase_migrations.schema_migrations(version text primary key, statements text[], name text)
//   file name pattern ^([0-9]+)_(.*)\.sql$  (0001_init.sql -> version "0001", name "init")

import { hkdfSync } from "node:crypto";

/** pg_advisory_lock key shared by every migrate run ("reflow:migrate"). */
export const ADVISORY_LOCK_KEY = "7270131017";

export const MIGRATION_FILE = /^([0-9]+)_(.*)\.sql$/;

/** Env vars checked for the database URL, in order. */
export const DATABASE_URL_VARS = ["POSTGRES_URL_NON_POOLING", "POSTGRES_URL", "SUPABASE_DB_URL"];

/**
 * @typedef {{ version: string, name: string, file: string }} MigrationFile
 * @typedef {MigrationFile & { sql: string }} MigrationSource
 * @typedef {{ version: string, name: string | null }} AppliedMigration
 * @typedef {Record<string, string | undefined>} Env
 * @typedef {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} Queryable
 * @typedef {{ info: (message: string) => void, warn: (message: string) => void }} Logger
 */

/** @param {string} file @returns {MigrationFile | null} */
export function parseMigrationFilename(file) {
  const match = MIGRATION_FILE.exec(file);
  if (!match) return null;
  return { version: match[1], name: match[2], file };
}

/** Migration files sorted by numeric version (then file name). Other files are ignored. @param {string[]} fileNames @returns {MigrationFile[]} */
export function sortMigrationFiles(fileNames) {
  return fileNames
    .map(parseMigrationFilename)
    .filter((m) => m !== null)
    .sort((a, b) => {
      const byVersion = compareVersions(a.version, b.version);
      return byVersion !== 0 ? byVersion : a.file.localeCompare(b.file);
    });
}

/** Numeric comparison of version strings of any length ("0010" > "0009", "20260101..." > "0008"). */
export function compareVersions(a, b) {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** @param {string | undefined} value */
function clean(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? undefined : trimmed;
}

/** @param {Env} env @returns {{ url: string, source: string } | null} */
export function resolveDatabaseUrl(env) {
  for (const name of DATABASE_URL_VARS) {
    const value = clean(env[name]);
    if (value) return { url: value, source: name };
  }
  return null;
}

/** True for "1", "true", "yes", "on". @param {string | undefined} value */
function truthy(value) {
  return /^(1|true|yes|on)$/i.test(clean(value) ?? "");
}

/**
 * Whether this invocation should migrate.
 *   - REFLOW_SKIP_MIGRATIONS=true: skip (for members who run `supabase db push` themselves).
 *   - On Vercel, only production builds migrate (preview builds may share the production database URL).
 *   - Without a database URL: skip with --if-configured (the build step), error otherwise (`pnpm db:migrate`).
 * @param {Env} env
 * @param {{ ifConfigured?: boolean }} [options]
 * @returns {{ action: "run", url: string, source: string } | { action: "skip", reason: string } | { action: "error", reason: string }}
 */
export function decideRun(env, options = {}) {
  if (truthy(env.REFLOW_SKIP_MIGRATIONS)) return { action: "skip", reason: "REFLOW_SKIP_MIGRATIONS is set" };
  if (clean(env.VERCEL) && clean(env.VERCEL_ENV) !== "production") {
    return { action: "skip", reason: `Vercel ${clean(env.VERCEL_ENV) ?? "non-production"} build: migrations only run for production deployments` };
  }
  const resolved = resolveDatabaseUrl(env);
  if (!resolved) {
    const reason = `no database URL (${DATABASE_URL_VARS.join(", ")})`;
    return options.ifConfigured ? { action: "skip", reason } : { action: "error", reason: `${reason} is set` };
  }
  try {
    return { action: "run", url: normalizeDatabaseUrl(resolved.url), source: resolved.source };
  } catch {
    return { action: "error", reason: `${resolved.source} is not a valid postgres:// URL (percent-encode special characters in the password)` };
  }
}

/**
 * Make an integration URL usable by node-postgres: drop the `supa` marker the
 * Vercel Supabase integration appends, and give `sslmode=require` libpq
 * semantics (encrypt without verifying the chain) via `uselibpqcompat=true`.
 * @param {string} raw
 */
export function normalizeDatabaseUrl(raw) {
  const url = new URL(raw);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error("not a postgres URL");
  url.searchParams.delete("supa");
  if (url.searchParams.get("sslmode") === "require" && !url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  return url.toString();
}

/** "user@host:port/database" for logs: never the password or query. @param {string} raw */
export function describeDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    const user = url.username ? `${decodeURIComponent(url.username)}@` : "";
    return `${user}${url.hostname}:${url.port || "5432"}${url.pathname || ""}`;
  } catch {
    return "(unparseable URL)";
  }
}

/** Supavisor transaction mode (port 6543) does not keep session state, so session advisory locks are not used there. @param {string} raw */
export function usesTransactionPooler(raw) {
  try {
    return new URL(raw).port === "6543";
  } catch {
    return false;
  }
}

/**
 * Decide which files to apply.
 * A file counts as applied when its version, its name or "<version>_<name>" is
 * tracked (databases migrated through the Supabase MCP carry timestamp versions
 * but the same names).
 * @param {{ files: MigrationFile[], applied: AppliedMigration[], hasStudioSchema: boolean, baseline?: string }} input
 * @returns {{ pending: MigrationFile[], baselined: MigrationFile[], error?: string }}
 */
export function planMigrations({ files, applied, hasStudioSchema, baseline }) {
  const versions = new Set(applied.map((a) => a.version));
  const names = new Set(applied.map((a) => a.name).filter((n) => typeof n === "string" && n !== ""));
  const isApplied = (f) => versions.has(f.version) || names.has(f.name) || names.has(`${f.version}_${f.name}`) || names.has(f.file);
  const baselineValue = clean(baseline);

  if (baselineValue !== undefined && !/^[0-9]+$/.test(baselineValue)) {
    return { pending: [], baselined: [], error: `REFLOW_MIGRATE_BASELINE must be a migration number such as 0006 (got "${baselineValue}")` };
  }
  if (baselineValue !== undefined && !hasStudioSchema) {
    return { pending: [], baselined: [], error: "REFLOW_MIGRATE_BASELINE is set but this database has no Reflow Studio schema (public.workspaces); unset it so every migration runs" };
  }

  const pending = [];
  const baselined = [];
  for (const file of files) {
    if (isApplied(file)) continue;
    if (baselineValue !== undefined && compareVersions(file.version, baselineValue) <= 0) baselined.push(file);
    else pending.push(file);
  }

  if (hasStudioSchema && baselineValue === undefined && !files.some(isApplied)) {
    return {
      pending: [],
      baselined: [],
      error:
        "This database already has the Reflow Studio schema (public.workspaces) but no migration history in supabase_migrations.schema_migrations. " +
        "Set REFLOW_MIGRATE_BASELINE to the last migration that is already applied (for example 0006) and redeploy, " +
        "or run `supabase migration repair --status applied <versions>`.",
    };
  }

  const appliedLocal = files.filter(isApplied);
  const newestApplied = appliedLocal.length ? appliedLocal[appliedLocal.length - 1] : null;
  const gap = newestApplied ? pending.find((f) => compareVersions(f.version, newestApplied.version) < 0) : undefined;
  if (gap) {
    return {
      pending: [],
      baselined: [],
      error: `Migration ${gap.file} is older than the applied ${newestApplied.file} but is not recorded as applied. Apply it by hand or record it with REFLOW_MIGRATE_BASELINE / supabase migration repair, then redeploy.`,
    };
  }
  return { pending, baselined };
}

// ---------------------------------------------------------------------------
// Secrets and settings the build writes into the database
// ---------------------------------------------------------------------------

/** Same rule as looksLikePlaceholder in src/lib/secrets.ts. @param {string} value */
export function looksLikePlaceholder(value) {
  return /[<>]|\bopenssl\b|\brand\s+-(?:hex|base64)\b|randomBytes|change[-_ ]?me|replace[-_ ]?me|your[-_ ]secret|^x{6,}$/i.test(value.trim());
}

/** HKDF-SHA256(master, salt "", info "reflow:<purpose>"), base64url; mirrors deriveSecret in src/lib/secrets.ts. */
export function deriveSecret(master, purpose) {
  return Buffer.from(hkdfSync("sha256", master, "", `reflow:${purpose}`, 32)).toString("base64url");
}

/** RECONCILE_SECRET, else derived from REFLOW_SECRET, else WEBHOOK_SECRET (the app resolves it the same way). @param {Env} env */
export function resolveReconcileSecret(env) {
  const explicit = clean(env.RECONCILE_SECRET);
  const master = clean(env.REFLOW_SECRET);
  const webhook = clean(env.WEBHOOK_SECRET);
  const value = explicit ?? (master ? deriveSecret(master, "reconcile") : webhook);
  if (!value || value.length < 16 || looksLikePlaceholder(value)) return undefined;
  return value;
}

/** Public URL pg_cron should call: APP_BASE_URL, else https://VERCEL_PROJECT_PRODUCTION_URL; never localhost or example hosts. @param {Env} env */
export function resolveAppBaseUrl(env) {
  const explicit = clean(env.APP_BASE_URL);
  const production = clean(env.VERCEL_PROJECT_PRODUCTION_URL);
  const value = explicit ? explicit.replace(/\/+$/, "") : production ? `https://${production}` : undefined;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname) || /(^|\.)example\.(com|org|net)$/i.test(url.hostname)) return undefined;
  } catch {
    return undefined;
  }
  return value;
}

/** OWNER_EMAILS as the database allowlist wants it: lower-cased, de-duplicated, placeholders dropped. @param {Env} env */
export function parseOwnerEmails(env) {
  const list = (clean(env.OWNER_EMAILS) ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.indexOf("@") > 0 && !looksLikePlaceholder(e) && !/@example\.(com|org|net)$/.test(e));
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const TRACKING_DDL = [
  "create schema if not exists supabase_migrations",
  "create table if not exists supabase_migrations.schema_migrations (version text not null primary key)",
  "alter table supabase_migrations.schema_migrations add column if not exists statements text[]",
  "alter table supabase_migrations.schema_migrations add column if not exists name text",
];

/**
 * Apply pending migrations, then write the vault secrets and the sign-up allowlist.
 * Each file runs in its own transaction together with its tracking row.
 * Post-steps (vault, allowlist) only warn on failure: a missing vault must not block a deploy.
 * @param {{ client: Queryable, url: string, migrations: MigrationSource[], env: Env, log: Logger }} input
 * @returns {Promise<{ applied: string[], baselined: string[], vault: Record<string, "created" | "updated" | "unchanged" | "skipped">, allowlist: number | null }>}
 */
export async function runMigrations({ client, url, migrations, env, log }) {
  const pooled = usesTransactionPooler(url);
  if (!pooled) await client.query("select pg_advisory_lock($1::bigint)", [ADVISORY_LOCK_KEY]);
  try {
    for (const statement of TRACKING_DDL) await client.query(statement);
    const { rows: appliedRows } = await client.query("select version, name from supabase_migrations.schema_migrations");
    const { rows: schemaRows } = await client.query("select to_regclass('public.workspaces') is not null as present");
    const plan = planMigrations({
      files: migrations,
      applied: appliedRows.map((r) => ({ version: String(r.version), name: r.name ?? null })),
      hasStudioSchema: Boolean(schemaRows[0]?.present),
      baseline: env.REFLOW_MIGRATE_BASELINE,
    });
    if (plan.error) throw new Error(plan.error);

    const byFile = new Map(migrations.map((m) => [m.file, m]));
    if (plan.baselined.length) {
      await client.query("begin");
      try {
        for (const file of plan.baselined) {
          await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3) on conflict (version) do nothing", [file.version, file.name, []]);
        }
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      }
      log.info(`recorded ${plan.baselined.map((f) => f.file).join(", ")} as already applied (REFLOW_MIGRATE_BASELINE)`);
    }

    const applied = [];
    for (const file of plan.pending) {
      const source = byFile.get(file.file);
      await client.query("begin");
      try {
        if (pooled) await client.query("select pg_advisory_xact_lock($1::bigint)", [ADVISORY_LOCK_KEY]);
        const { rows: already } = await client.query("select 1 from supabase_migrations.schema_migrations where version = $1", [file.version]);
        if (already.length) {
          await client.query("commit");
          log.info(`${file.file} was applied by a concurrent run`);
          continue;
        }
        await client.query(source.sql);
        await client.query("insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)", [file.version, file.name, [source.sql]]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback").catch(() => {});
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${file.file} failed and was rolled back: ${message}`);
      }
      applied.push(file.file);
      log.info(`applied ${file.file}`);
    }
    if (!applied.length) log.info("database schema is up to date");

    const vault = await seedVault(client, env, log);
    const allowlist = await syncAllowlist(client, env, log);
    return { applied, baselined: plan.baselined.map((f) => f.file), vault, allowlist };
  } finally {
    if (!pooled) await client.query("select pg_advisory_unlock($1::bigint)", [ADVISORY_LOCK_KEY]).catch(() => {});
  }
}

/** @param {Queryable} client @param {Env} env @param {Logger} log */
async function seedVault(client, env, log) {
  /** @type {Record<string, "created" | "updated" | "unchanged" | "skipped">} */
  const result = { app_base_url: "skipped", reconcile_secret: "skipped" };
  try {
    const { rows } = await client.query("select to_regclass('vault.secrets') is not null as present");
    if (!rows[0]?.present) {
      log.warn("Supabase Vault is not available: skipped app_base_url / reconcile_secret (the pg_cron reconciler stays idle)");
      return result;
    }
    const values = { app_base_url: resolveAppBaseUrl(env), reconcile_secret: resolveReconcileSecret(env) };
    for (const [name, value] of Object.entries(values)) {
      if (!value) {
        log.warn(`vault secret ${name}: no usable value in this environment, left unchanged`);
        continue;
      }
      const { rows: existing } = await client.query("select id, decrypted_secret from vault.decrypted_secrets where name = $1 limit 1", [name]);
      if (existing[0]?.decrypted_secret === value) {
        result[name] = "unchanged";
      } else if (existing[0]) {
        await client.query("select vault.update_secret($1::uuid, $2)", [existing[0].id, value]);
        result[name] = "updated";
      } else {
        await client.query("select vault.create_secret($1, $2)", [value, name]);
        result[name] = "created";
      }
      log.info(`vault secret ${name}: ${result[name]}`);
    }
  } catch (err) {
    log.warn(`could not write the vault secrets (${err instanceof Error ? err.message : String(err)}); set them by hand, see supabase/migrations/0002_reconcile_cron.sql`);
  }
  return result;
}

/** @param {Queryable} client @param {Env} env @param {Logger} log */
async function syncAllowlist(client, env, log) {
  try {
    const { rows } = await client.query("select to_regprocedure('public.sync_allowed_emails(text[])') is not null as present");
    if (!rows[0]?.present) return null;
    const emails = parseOwnerEmails(env);
    const { rows: synced } = await client.query("select public.sync_allowed_emails($1::text[]) as count", [emails]);
    const count = Number(synced[0]?.count ?? 0);
    if (count === 0) log.warn("OWNER_EMAILS is empty: the database refuses every new account until it is set");
    else log.info(`sign-up allowlist: ${count} address${count === 1 ? "" : "es"} from OWNER_EMAILS`);
    return count;
  } catch (err) {
    log.warn(`could not sync the sign-up allowlist (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
