#!/usr/bin/env node
// Apply supabase/migrations to the configured database, then write the vault
// secrets the pg_cron reconciler needs and sync the sign-up allowlist.
//
//   node scripts/migrate.mjs --if-configured   (build step: skips without a database URL)
//   node scripts/migrate.mjs                   (pnpm db:migrate: fails without one)
//   node --env-file=.env.local scripts/migrate.mjs   (local run with your .env.local)
//
// Database URL: POSTGRES_URL_NON_POOLING || POSTGRES_URL || SUPABASE_DB_URL
// (Supabase dashboard, Connect, "Session pooler"; the direct db.<ref> host is
// IPv6-only and unreachable from Vercel builds). On Vercel only production
// builds migrate. REFLOW_MIGRATE_BASELINE=0006 adopts a database whose schema
// was applied by hand; REFLOW_SKIP_MIGRATIONS=true turns the step off.
// Never logs secrets or the database password.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideRun, describeDatabaseUrl, runMigrations, sortMigrationFiles } from "./migrate-lib.mjs";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

const log = {
  info: (message) => console.log(`[migrate] ${message}`),
  warn: (message) => console.warn(`[migrate] warning: ${message}`),
};

async function main() {
  const ifConfigured = process.argv.includes("--if-configured");
  const decision = decideRun(process.env, { ifConfigured });
  if (decision.action === "skip") {
    log.info(`skipped: ${decision.reason}`);
    return 0;
  }
  if (decision.action === "error") {
    console.error(`[migrate] ${decision.reason}`);
    return 1;
  }

  const migrations = sortMigrationFiles(readdirSync(MIGRATIONS_DIR)).map((m) => ({ ...m, sql: readFileSync(`${MIGRATIONS_DIR}${m.file}`, "utf8") }));
  log.info(`${migrations.length} migration file(s); database ${describeDatabaseUrl(decision.url)} (from ${decision.source})`);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: decision.url, connectionTimeoutMillis: 15_000, application_name: "reflow-migrate" });
  try {
    await client.connect();
  } catch (err) {
    console.error(`[migrate] cannot connect to ${describeDatabaseUrl(decision.url)}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  try {
    const result = await runMigrations({ client, url: decision.url, migrations, env: process.env, log });
    log.info(`done: ${result.applied.length} applied${result.baselined.length ? `, ${result.baselined.length} baselined` : ""}`);
    return 0;
  } catch (err) {
    console.error(`[migrate] ${err instanceof Error ? err.message : String(err)}`);
    console.error("[migrate] the build stops here so the previous deployment stays live");
    return 1;
  } finally {
    await client.end().catch(() => {});
  }
}

process.exitCode = await main();
