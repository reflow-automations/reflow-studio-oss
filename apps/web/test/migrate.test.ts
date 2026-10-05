import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADVISORY_LOCK_KEY,
  decideRun,
  deriveSecret,
  describeDatabaseUrl,
  normalizeDatabaseUrl,
  parseMigrationFilename,
  parseOwnerEmails,
  planMigrations,
  resolveAppBaseUrl,
  resolveDatabaseUrl,
  resolveReconcileSecret,
  runMigrations,
  sortMigrationFiles,
  usesTransactionPooler,
} from "../scripts/migrate-lib.mjs";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const SESSION_URL = "postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";
const POOLED_URL = "postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres";

describe("migration files", () => {
  it("parses names like the Supabase CLI", () => {
    expect(parseMigrationFilename("0001_init.sql")).toEqual({ version: "0001", name: "init", file: "0001_init.sql" });
    expect(parseMigrationFilename("20260928120000_add_x.sql")).toEqual({ version: "20260928120000", name: "add_x", file: "20260928120000_add_x.sql" });
    for (const name of ["README.md", "init.sql", "0001-init.sql", "0001_init.sql.bak", "x0001_init.sql"]) expect(parseMigrationFilename(name), name).toBeNull();
  });

  it("sorts numerically and ignores other files", () => {
    const sorted = sortMigrationFiles(["0010_ten.sql", "notes.txt", "0002_two.sql", "0009_nine.sql", "0001_one.sql"]).map((f) => f.file);
    expect(sorted).toEqual(["0001_one.sql", "0002_two.sql", "0009_nine.sql", "0010_ten.sql"]);
  });

  it("finds a contiguous 0001..N series in supabase/migrations", () => {
    const files = sortMigrationFiles(readdirSync(MIGRATIONS_DIR));
    expect(files.length).toBeGreaterThanOrEqual(8);
    files.forEach((f, i) => expect(Number(f.version), f.file).toBe(i + 1));
  });
});

describe("decideRun", () => {
  it("prefers the non-pooling integration URL, then POSTGRES_URL, then SUPABASE_DB_URL", () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: "postgres://a", SUPABASE_DB_URL: "postgres://b", POSTGRES_URL_NON_POOLING: "postgres://c" })).toEqual({ url: "postgres://c", source: "POSTGRES_URL_NON_POOLING" });
    expect(resolveDatabaseUrl({ POSTGRES_URL: " ", SUPABASE_DB_URL: "postgres://b" })).toEqual({ url: "postgres://b", source: "SUPABASE_DB_URL" });
    expect(resolveDatabaseUrl({})).toBeNull();
  });

  it("skips without a database URL in the build, but errors for db:migrate", () => {
    expect(decideRun({}, { ifConfigured: true })).toMatchObject({ action: "skip" });
    expect(decideRun({}, {})).toMatchObject({ action: "error" });
  });

  it("only migrates production builds on Vercel", () => {
    expect(decideRun({ VERCEL: "1", VERCEL_ENV: "preview", POSTGRES_URL: SESSION_URL }, { ifConfigured: true })).toMatchObject({ action: "skip" });
    expect(decideRun({ VERCEL: "1", VERCEL_ENV: "development", POSTGRES_URL: SESSION_URL }, {})).toMatchObject({ action: "skip" });
    expect(decideRun({ VERCEL: "1", VERCEL_ENV: "production", POSTGRES_URL: SESSION_URL }, { ifConfigured: true })).toMatchObject({ action: "run", source: "POSTGRES_URL" });
    expect(decideRun({ SUPABASE_DB_URL: SESSION_URL }, { ifConfigured: true })).toMatchObject({ action: "run" });
  });

  it("honours REFLOW_SKIP_MIGRATIONS", () => {
    expect(decideRun({ REFLOW_SKIP_MIGRATIONS: "true", SUPABASE_DB_URL: SESSION_URL }, {})).toMatchObject({ action: "skip" });
  });

  it("reports an unparseable URL without echoing it", () => {
    const result = decideRun({ SUPABASE_DB_URL: "postgresql://postgres:sec ret@[bad" }, {});
    expect(result.action).toBe("error");
    expect(JSON.stringify(result)).not.toContain("sec ret");
    expect(decideRun({ SUPABASE_DB_URL: "https://not-postgres.example" }, {}).action).toBe("error");
  });
});

describe("URL handling", () => {
  it("strips the integration's supa marker and adds libpq semantics to sslmode=require", () => {
    const url = new URL(normalizeDatabaseUrl(`${SESSION_URL}?sslmode=require&supa=base-pooler.x`));
    expect(url.searchParams.get("supa")).toBeNull();
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("uselibpqcompat")).toBe("true");
    expect(new URL(normalizeDatabaseUrl(`${SESSION_URL}?sslmode=verify-full`)).searchParams.get("uselibpqcompat")).toBeNull();
    expect(new URL(normalizeDatabaseUrl(SESSION_URL)).password).toBe("pw");
  });

  it("describes a URL without its password or query", () => {
    const text = describeDatabaseUrl(`postgresql://postgres.ref:p%40ss@host.pooler.supabase.com:5432/postgres?sslmode=require&password=x`);
    expect(text).toBe("postgres.ref@host.pooler.supabase.com:5432/postgres");
    expect(describeDatabaseUrl("::nonsense::")).toBe("(unparseable URL)");
  });

  it("detects the transaction pooler port", () => {
    expect(usesTransactionPooler(POOLED_URL)).toBe(true);
    expect(usesTransactionPooler(SESSION_URL)).toBe(false);
  });
});

describe("planMigrations", () => {
  const files = sortMigrationFiles(["0001_init.sql", "0002_cron.sql", "0003_keys.sql", "0004_more.sql"]);

  it("applies everything on an empty database", () => {
    expect(planMigrations({ files, applied: [], hasStudioSchema: false }).pending.map((f) => f.version)).toEqual(["0001", "0002", "0003", "0004"]);
  });

  it("applies only new files when history exists", () => {
    const plan = planMigrations({ files, applied: [{ version: "0001", name: "init" }, { version: "0002", name: "cron" }], hasStudioSchema: true });
    expect(plan.error).toBeUndefined();
    expect(plan.pending.map((f) => f.version)).toEqual(["0003", "0004"]);
  });

  it("recognises history written by the Supabase MCP (timestamp versions, same names)", () => {
    const plan = planMigrations({ files, applied: [{ version: "20260928120000", name: "init" }, { version: "20260928120100", name: "0002_cron" }], hasStudioSchema: true });
    expect(plan.pending.map((f) => f.version)).toEqual(["0003", "0004"]);
  });

  it("stops on an existing schema without history and explains the baseline", () => {
    const plan = planMigrations({ files, applied: [], hasStudioSchema: true });
    expect(plan.pending).toEqual([]);
    expect(plan.error).toMatch(/REFLOW_MIGRATE_BASELINE/);
    expect(plan.error).toMatch(/supabase migration repair/);
  });

  it("baselines up to REFLOW_MIGRATE_BASELINE and applies the rest", () => {
    const plan = planMigrations({ files, applied: [], hasStudioSchema: true, baseline: "0002" });
    expect(plan.baselined.map((f) => f.version)).toEqual(["0001", "0002"]);
    expect(plan.pending.map((f) => f.version)).toEqual(["0003", "0004"]);
  });

  it("refuses a baseline on an empty database or a malformed value", () => {
    expect(planMigrations({ files, applied: [], hasStudioSchema: false, baseline: "0002" }).error).toMatch(/no Reflow Studio schema/);
    expect(planMigrations({ files, applied: [], hasStudioSchema: true, baseline: "six" }).error).toMatch(/must be a migration number/);
  });

  it("refuses to run an old file that was skipped (out of order)", () => {
    const plan = planMigrations({ files, applied: [{ version: "0001", name: "init" }, { version: "0003", name: "keys" }], hasStudioSchema: true });
    expect(plan.error).toMatch(/0002_cron\.sql is older than the applied 0003_keys\.sql/);
  });
});

describe("secrets and settings for the database", () => {
  it("resolves the reconcile secret like the app", () => {
    const master = "a-very-long-random-deploy-secret-0123456789";
    expect(resolveReconcileSecret({ REFLOW_SECRET: master })).toBe(deriveSecret(master, "reconcile"));
    expect(resolveReconcileSecret({ REFLOW_SECRET: master, RECONCILE_SECRET: "explicit-reconcile-secret" })).toBe("explicit-reconcile-secret");
    expect(resolveReconcileSecret({ WEBHOOK_SECRET: "legacy-webhook-secret-value" })).toBe("legacy-webhook-secret-value");
    expect(resolveReconcileSecret({ WEBHOOK_SECRET: "<openssl rand -hex 32>" })).toBeUndefined();
    expect(resolveReconcileSecret({ RECONCILE_SECRET: "short" })).toBeUndefined();
    expect(resolveReconcileSecret({})).toBeUndefined();
  });

  it("resolves the public base URL and refuses hosts pg_cron cannot use", () => {
    expect(resolveAppBaseUrl({ APP_BASE_URL: "https://studio.dev/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://studio.dev");
    expect(resolveAppBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://x.vercel.app");
    for (const value of ["http://localhost:3000", "https://studio.example.com", "not a url", "ftp://files.dev"]) expect(resolveAppBaseUrl({ APP_BASE_URL: value }), value).toBeUndefined();
  });

  it("parses OWNER_EMAILS for the allowlist", () => {
    expect(parseOwnerEmails({ OWNER_EMAILS: " Me@Studio.dev, other@studio.dev,me@studio.dev, you@example.com, <email>, nope" })).toEqual(["me@studio.dev", "other@studio.dev"]);
    expect(parseOwnerEmails({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runMigrations against a fake pg client
// ---------------------------------------------------------------------------

interface FakeState {
  applied: Array<{ version: string; name: string; statements: string[] }>;
  hasSchema: boolean;
  vault: Map<string, { id: string; value: string }> | null;
  allowlist: string[] | null;
  executed: string[];
}

function fakeClient(state: FakeState) {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  let tx: FakeState["applied"] | null = null;
  const client = {
    queries,
    async query(text: string, params?: unknown[]) {
      queries.push({ text, params });
      const t = text.trim();
      if (/^select pg_advisory_(un)?lock|^select pg_advisory_xact_lock/.test(t)) return { rows: [] };
      if (/^(create schema|create table|alter table) .*supabase_migrations/.test(t)) return { rows: [] };
      if (t === "begin") {
        tx = [];
        return { rows: [] };
      }
      if (t === "commit") {
        state.applied.push(...(tx ?? []));
        tx = null;
        return { rows: [] };
      }
      if (t === "rollback") {
        tx = null;
        return { rows: [] };
      }
      if (t.startsWith("select version, name from supabase_migrations")) return { rows: state.applied.map(({ version, name }) => ({ version, name })) };
      if (t.startsWith("select to_regclass('public.workspaces')")) return { rows: [{ present: state.hasSchema }] };
      if (t.startsWith("insert into supabase_migrations.schema_migrations")) {
        const [version, name, statements] = params as [string, string, string[]];
        (tx ?? state.applied).push({ version, name, statements });
        return { rows: [] };
      }
      if (t.startsWith("select 1 from supabase_migrations")) return { rows: state.applied.filter((a) => a.version === params?.[0]).map(() => ({ "?column?": 1 })) };
      if (t.startsWith("select to_regclass('vault.secrets')")) return { rows: [{ present: state.vault !== null }] };
      if (t.startsWith("select id, decrypted_secret from vault.decrypted_secrets")) {
        const hit = state.vault?.get(String(params?.[0]));
        return { rows: hit ? [{ id: hit.id, decrypted_secret: hit.value }] : [] };
      }
      if (t.startsWith("select vault.update_secret")) {
        for (const [name, entry] of state.vault ?? []) if (entry.id === params?.[0]) state.vault!.set(name, { id: entry.id, value: String(params?.[1]) });
        return { rows: [] };
      }
      if (t.startsWith("select vault.create_secret")) {
        state.vault!.set(String(params?.[1]), { id: `id-${state.vault!.size + 1}`, value: String(params?.[0]) });
        return { rows: [] };
      }
      if (t.startsWith("select to_regprocedure('public.sync_allowed_emails")) return { rows: [{ present: state.allowlist !== null }] };
      if (t.startsWith("select public.sync_allowed_emails")) {
        state.allowlist = [...(params?.[0] as string[])];
        return { rows: [{ count: state.allowlist.length }] };
      }
      // Anything else is migration SQL.
      if (t.includes("BOOM")) throw new Error('relation "does_not_exist" does not exist');
      state.executed.push(t);
      return { rows: [] };
    },
  };
  return client;
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return { applied: [], hasSchema: false, vault: new Map(), allowlist: [], executed: [], ...overrides };
}

const MIGRATIONS = sortMigrationFiles(["0001_init.sql", "0002_cron.sql", "0003_keys.sql"]).map((f) => ({ ...f, sql: `-- ${f.file}\nselect 1;` }));
const MASTER = "a-very-long-random-deploy-secret-0123456789";
const ENV = { REFLOW_SECRET: MASTER, VERCEL_PROJECT_PRODUCTION_URL: "studio.vercel.app", OWNER_EMAILS: "Owner@Studio.dev" };

function logger() {
  const lines: string[] = [];
  return { lines, info: (m: string) => lines.push(m), warn: (m: string) => lines.push(`warning: ${m}`) };
}

describe("runMigrations", () => {
  it("applies pending files with tracking rows, then seeds the vault and the allowlist", async () => {
    const s = state();
    const client = fakeClient(s);
    const log = logger();
    const result = await runMigrations({ client, url: SESSION_URL, migrations: MIGRATIONS, env: ENV, log });
    expect(result.applied).toEqual(["0001_init.sql", "0002_cron.sql", "0003_keys.sql"]);
    expect(s.applied.map((a) => [a.version, a.name, a.statements.length])).toEqual([
      ["0001", "init", 1],
      ["0002", "cron", 1],
      ["0003", "keys", 1],
    ]);
    expect(s.vault?.get("reconcile_secret")?.value).toBe(deriveSecret(MASTER, "reconcile"));
    expect(s.vault?.get("app_base_url")?.value).toBe("https://studio.vercel.app");
    expect(result.vault).toEqual({ app_base_url: "created", reconcile_secret: "created" });
    expect(s.allowlist).toEqual(["owner@studio.dev"]);
    expect(result.allowlist).toBe(1);
    // Session advisory lock around the whole run, released at the end.
    expect(client.queries[0]).toEqual({ text: "select pg_advisory_lock($1::bigint)", params: [ADVISORY_LOCK_KEY] });
    expect(client.queries.at(-1)?.text).toBe("select pg_advisory_unlock($1::bigint)");
    // Nothing secret reaches the log.
    expect(log.lines.join("\n")).not.toContain(MASTER);
    expect(log.lines.join("\n")).not.toContain(deriveSecret(MASTER, "reconcile"));
  });

  it("is a no-op on the second run and leaves unchanged vault secrets alone", async () => {
    const s = state();
    await runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: ENV, log: logger() });
    s.executed = [];
    const again = await runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: ENV, log: logger() });
    expect(again.applied).toEqual([]);
    expect(s.executed).toEqual([]);
    expect(again.vault).toEqual({ app_base_url: "unchanged", reconcile_secret: "unchanged" });
    const rotated = await runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: { ...ENV, RECONCILE_SECRET: "rotated-reconcile-secret-value" }, log: logger() });
    expect(rotated.vault.reconcile_secret).toBe("updated");
    expect(s.vault?.get("reconcile_secret")?.value).toBe("rotated-reconcile-secret-value");
  });

  it("uses a transaction-scoped lock on the transaction pooler", async () => {
    const s = state();
    const client = fakeClient(s);
    await runMigrations({ client, url: POOLED_URL, migrations: MIGRATIONS, env: {}, log: logger() });
    const texts = client.queries.map((q) => q.text);
    expect(texts).not.toContain("select pg_advisory_lock($1::bigint)");
    expect(texts.filter((t) => t === "select pg_advisory_xact_lock($1::bigint)")).toHaveLength(3);
  });

  it("rolls back a failing file, names it and keeps earlier files", async () => {
    const s = state();
    const broken = [...MIGRATIONS.slice(0, 2), { ...MIGRATIONS[2]!, sql: "select BOOM from does_not_exist;" }];
    await expect(runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: broken, env: {}, log: logger() })).rejects.toThrow(/0003_keys\.sql failed and was rolled back: relation "does_not_exist"/);
    expect(s.applied.map((a) => a.version)).toEqual(["0001", "0002"]);
  });

  it("stops before touching an untracked existing schema, and baselines when asked", async () => {
    const s = state({ hasSchema: true });
    await expect(runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: {}, log: logger() })).rejects.toThrow(/REFLOW_MIGRATE_BASELINE/);
    expect(s.executed).toEqual([]);
    const result = await runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: { REFLOW_MIGRATE_BASELINE: "0002" }, log: logger() });
    expect(result.baselined).toEqual(["0001_init.sql", "0002_cron.sql"]);
    expect(result.applied).toEqual(["0003_keys.sql"]);
    expect(s.applied.map((a) => [a.version, a.statements.length])).toEqual([
      ["0001", 0],
      ["0002", 0],
      ["0003", 1],
    ]);
  });

  it("skips a file a concurrent run already applied", async () => {
    const s = state();
    const client = fakeClient(s);
    const original = client.query.bind(client);
    let injected = false;
    client.query = async (text: string, params?: unknown[]) => {
      if (!injected && text.startsWith("select 1 from supabase_migrations")) {
        injected = true;
        s.applied.push({ version: "0001", name: "init", statements: [] });
      }
      return original(text, params);
    };
    const result = await runMigrations({ client, url: SESSION_URL, migrations: MIGRATIONS, env: {}, log: logger() });
    expect(result.applied).toEqual(["0002_cron.sql", "0003_keys.sql"]);
  });

  it("warns instead of failing when the vault is missing, and empties the allowlist without OWNER_EMAILS", async () => {
    const s = state({ vault: null, allowlist: ["old@studio.dev"] });
    const log = logger();
    const result = await runMigrations({ client: fakeClient(s), url: SESSION_URL, migrations: MIGRATIONS, env: { REFLOW_SECRET: MASTER }, log });
    expect(result.vault).toEqual({ app_base_url: "skipped", reconcile_secret: "skipped" });
    expect(s.allowlist).toEqual([]);
    expect(log.lines.some((l) => /Vault is not available/.test(l))).toBe(true);
    expect(log.lines.some((l) => /OWNER_EMAILS is empty/.test(l))).toBe(true);
  });
});
