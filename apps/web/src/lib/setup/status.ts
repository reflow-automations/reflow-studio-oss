import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ownerEmails } from "@/lib/auth/owner";
import type { Database, ReconcileConfig } from "@/lib/db/types";
import { appBaseUrl, parseEnv, withoutEmpty, withSupabaseFallbacks, type EnvSource } from "@/lib/env";
import { looksLikePlaceholder, resolveSecrets, sha256HexSync } from "@/lib/secrets";
import { listProviderKeys, type ProviderKeyView } from "@/lib/settings/provider-keys";
import { REQUIRED_SCHEMA_VERSION } from "@/lib/setup/schema";
import { r2ConfigFromEnv } from "@/lib/storage/r2";

/**
 * Setup checklist for the public /setup page and Settings. Every check reports
 * a status and a hint that names variables or steps, never a value, so the
 * result is safe to render to anyone. Checks never throw: a failing dependency
 * becomes a "missing" or "warn" item.
 */

export type SetupItemStatus = "ok" | "missing" | "warn";
export type SetupItemId = "supabase" | "secrets" | "owner_emails" | "environment" | "database" | "owner_account" | "allowlist" | "providers" | "storage" | "reconciler" | "budget";

export interface SetupItem {
  id: SetupItemId;
  label: string;
  status: SetupItemStatus;
  hint: string;
  /** Anchor in docs/SETUP.md (without "#"). */
  docsAnchor?: string;
}

export interface SetupStatus {
  /** True when no item is "missing" (warnings are allowed). */
  ok: boolean;
  items: SetupItem[];
  /** public.studio_schema_version(), or null when it is missing or unreachable. */
  schemaVersion: number | null;
  requiredSchemaVersion: number;
  /** An auth account exists for an OWNER_EMAILS address (any account when OWNER_EMAILS is empty outside production). */
  ownerExists: boolean;
  /** ENABLE_MOCK_PROVIDER=true: generations use the free mock provider. */
  demoMode: boolean;
}

export interface SetupStatusOptions {
  /** Defaults to process.env. */
  env?: EnvSource;
  /** Service-role client; defaults to one built from the environment (null when Supabase is not configured). */
  admin?: SupabaseClient<Database> | null;
  /** Provider key overview for a workspace; defaults to listProviderKeys. */
  listProviders?: (workspaceId: string) => Promise<ProviderKeyView[]>;
  /** Per-check time limit (default 5000 ms). */
  timeoutMs?: number;
}

const ENV_KEY_VARS = ["FAL_KEY", "KIE_API_KEY", "HIGGSFIELD_API_CREDENTIAL"] as const;

/** Error codes meaning "the function does not exist": PostgREST schema cache miss, Postgres undefined_function. */
export function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

class TimeoutError extends Error {}

async function within<T>(ms: number, work: () => PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(work()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  if (err instanceof TimeoutError) return err.message;
  if (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string") return `error ${(err as { code: string }).code}`;
  return err instanceof Error ? err.name : "unknown error";
}

/** Service-role client straight from the (fallback-resolved) environment, independent of the full env() validation. */
export function setupAdminClient(source: EnvSource = process.env): SupabaseClient<Database> | null {
  const env = withSupabaseFallbacks(withoutEmpty(source));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || looksLikePlaceholder(url) || looksLikePlaceholder(key)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Lower-cased e-mails of every auth user (first pages only: a personal studio has a handful). */
export async function listAuthEmails(admin: SupabaseClient<Database>, maxPages = 5): Promise<Array<{ id: string; email: string }>> {
  const out: Array<{ id: string; email: string }> = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const user of data.users) if (user.email) out.push({ id: user.id, email: user.email.toLowerCase() });
    if (data.users.length < 200) break;
  }
  return out;
}

export async function getSetupStatus(options: SetupStatusOptions = {}): Promise<SetupStatus> {
  const source = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 5000;
  const env = withSupabaseFallbacks(withoutEmpty(source));
  const production = source.NODE_ENV === "production";
  const parsed = parseEnv(source);
  const issues = parsed.ok ? [] : parsed.issues;
  const issueFor = (...names: string[]) => issues.filter((i) => names.includes(i.variable));
  const items: SetupItem[] = [];
  const demoMode = env.ENABLE_MOCK_PROVIDER === "true";
  const owners = ownerEmails(source).filter((e) => !looksLikePlaceholder(e));

  // 1. Supabase connection values -------------------------------------------------
  const supabaseMissing = [
    !env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
    !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
  ].filter(Boolean) as string[];
  const supabaseInvalid = issueFor("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  items.push({
    id: "supabase",
    label: "Supabase connection",
    status: supabaseMissing.length || supabaseInvalid.length ? "missing" : "ok",
    hint: supabaseMissing.length
      ? `Set ${supabaseMissing.join(", ")} (Supabase dashboard, Project settings, API keys). The Vercel Supabase integration sets them for you.`
      : supabaseInvalid.length
        ? `Check ${supabaseInvalid.map((i) => i.variable).join(", ")}: ${supabaseInvalid.map((i) => i.message).join("; ")}.`
        : "Project URL, publishable key and secret key are set.",
    docsAnchor: "supabase",
  });

  // 2. Deploy secret ------------------------------------------------------------------
  const secretIssues = issueFor("REFLOW_SECRET", "WEBHOOK_SECRET", "RECONCILE_SECRET", "KEY_ENCRYPTION_SECRET");
  const secrets = resolveSecrets(env);
  items.push({
    id: "secrets",
    label: "Deploy secret",
    status: secretIssues.length ? "missing" : secrets.sources.keyEncryption === "missing" ? "warn" : "ok",
    hint: secretIssues.length
      ? `${secretIssues.map((i) => i.message).join("; ")}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
      : secrets.sources.keyEncryption === "missing"
        ? "WEBHOOK_SECRET is set but there is no REFLOW_SECRET or KEY_ENCRYPTION_SECRET, so provider keys cannot be saved in the app (environment keys still work)."
        : secrets.sources.setup === "explicit"
          ? "REFLOW_SECRET is set; webhook, reconcile and encryption secrets are derived from it."
          : "Legacy secrets (WEBHOOK_SECRET and friends) are set.",
    docsAnchor: "secrets",
  });

  // 3. Owner allowlist (env) ------------------------------------------------------------
  const ownerIssue = issueFor("OWNER_EMAILS")[0];
  items.push({
    id: "owner_emails",
    label: "Owner e-mail (OWNER_EMAILS)",
    status: ownerIssue || owners.length === 0 ? (production || ownerIssue ? "missing" : "warn") : "ok",
    hint: ownerIssue
      ? ownerIssue.message
      : owners.length === 0
        ? "Set OWNER_EMAILS to the e-mail address you will sign in with (comma-separated for more than one). Without it production refuses every login."
        : `${owners.length} address${owners.length === 1 ? "" : "es"} may sign in.`,
    docsAnchor: "owner",
  });

  // 4. Everything else env() validates ---------------------------------------------------
  const covered = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "REFLOW_SECRET", "WEBHOOK_SECRET", "RECONCILE_SECRET", "KEY_ENCRYPTION_SECRET", "OWNER_EMAILS"]);
  const otherIssues = issues.filter((i) => !covered.has(i.variable));
  items.push({
    id: "environment",
    label: "Other environment variables",
    status: otherIssues.length ? "missing" : "ok",
    hint: otherIssues.length ? `Fix or remove: ${otherIssues.map((i) => `${i.variable} (${i.message})`).join("; ")}.` : "All other variables are valid (empty values count as unset).",
    docsAnchor: "environment",
  });

  // Database-backed checks ---------------------------------------------------------------
  const admin = options.admin === undefined ? setupAdminClient(source) : options.admin;
  let schemaVersion: number | null = null;
  let ownerExists = false;
  let ownerUserId: string | null = null;
  let schemaReady = false;
  const accountEmails = new Set<string>();

  if (!admin) {
    items.push({ id: "database", label: "Database schema", status: "missing", hint: "Configure the Supabase connection first.", docsAnchor: "database" });
    items.push({ id: "owner_account", label: "Owner account", status: "missing", hint: "Configure the Supabase connection first.", docsAnchor: "owner" });
  } else {
    // 5. Schema version
    try {
      const { data, error } = await within(timeoutMs, () => admin.rpc("studio_schema_version"));
      if (error) {
        items.push({
          id: "database",
          label: "Database schema",
          status: "missing",
          hint: isMissingFunctionError(error)
            ? "Migrations are not applied. Redeploy with POSTGRES_URL_NON_POOLING (or SUPABASE_DB_URL) set so the build applies supabase/migrations, or run them in the Supabase SQL editor in order."
            : `Cannot query the database (${describeError(error)}). Check the Supabase URL and secret key.`,
          docsAnchor: "database",
        });
      } else {
        schemaVersion = typeof data === "number" ? data : Number(data);
        schemaReady = schemaVersion >= REQUIRED_SCHEMA_VERSION;
        items.push({
          id: "database",
          label: "Database schema",
          status: schemaVersion < REQUIRED_SCHEMA_VERSION ? "missing" : schemaVersion > REQUIRED_SCHEMA_VERSION ? "warn" : "ok",
          hint:
            schemaVersion < REQUIRED_SCHEMA_VERSION
              ? `The database is at schema ${schemaVersion}; this app needs ${REQUIRED_SCHEMA_VERSION}. Apply the newer files in supabase/migrations (a production redeploy does it when POSTGRES_URL_NON_POOLING is set).`
              : schemaVersion > REQUIRED_SCHEMA_VERSION
                ? `The database is at schema ${schemaVersion}, newer than this app (${REQUIRED_SCHEMA_VERSION}). Deploy the latest code.`
                : `Schema ${schemaVersion} is up to date.`,
          docsAnchor: "database",
        });
      }
    } catch (err) {
      items.push({ id: "database", label: "Database schema", status: "missing", hint: `Cannot reach the database (${describeError(err)}).`, docsAnchor: "database" });
    }

    // 6. Owner account
    try {
      const users = await within(timeoutMs, () => listAuthEmails(admin));
      for (const user of users) accountEmails.add(user.email);
      const owner = owners.length ? users.find((u) => owners.includes(u.email)) : production ? undefined : users[0];
      ownerExists = Boolean(owner);
      ownerUserId = owner?.id ?? null;
      items.push({
        id: "owner_account",
        label: "Owner account",
        status: ownerExists ? "ok" : "missing",
        hint: ownerExists ? "An owner account exists. Sign in on /login." : "No owner account yet. Create it on this page with your OWNER_EMAILS address and REFLOW_SECRET.",
        docsAnchor: "owner",
      });
    } catch (err) {
      items.push({ id: "owner_account", label: "Owner account", status: "missing", hint: `Cannot list Supabase Auth users (${describeError(err)}). Check the secret key.`, docsAnchor: "owner" });
    }

    // 7. Database allowlist (private.allowed_emails, migration 0007)
    if (schemaReady) {
      try {
        const { data, error } = await within(timeoutMs, () => admin.rpc("studio_allowlist_status", { p_emails: owners }));
        if (error) throw error;
        // Addresses that already have an account do not need to be on the list.
        const missing = (data?.missing ?? []).filter((email) => !accountEmails.has(email));
        items.push({
          id: "allowlist",
          label: "Sign-up allowlist",
          status: owners.length === 0 || missing.length ? "warn" : "ok",
          hint:
            owners.length === 0
              ? `New accounts are blocked in the database except for ${data?.allowed_count ?? 0} listed address(es); set OWNER_EMAILS to manage the list.`
              : missing.length
                ? `${missing.length} OWNER_EMAILS address(es) cannot create an account yet. A production redeploy or the owner form on this page syncs the list.`
                : "Only OWNER_EMAILS addresses can create an account; every other sign-up is refused by the database.",
          docsAnchor: "owner",
        });
      } catch (err) {
        items.push({ id: "allowlist", label: "Sign-up allowlist", status: "warn", hint: `Could not read the allowlist (${describeError(err)}).`, docsAnchor: "owner" });
      }
    }
  }

  // 8. Providers ------------------------------------------------------------------------------
  if (demoMode) {
    items.push({ id: "providers", label: "AI providers", status: "ok", hint: "Demo mode (ENABLE_MOCK_PROVIDER=true): generations use the free mock provider.", docsAnchor: "providers" });
  } else {
    const envKeys = ENV_KEY_VARS.filter((name) => Boolean(env[name]));
    let views: ProviderKeyView[] | null = null;
    let providerError: string | null = null;
    if (admin && schemaReady && parsed.ok) {
      try {
        const workspaceId = await within(timeoutMs, () => findWorkspaceId(admin, ownerUserId));
        if (workspaceId) views = await within(timeoutMs, () => (options.listProviders ?? listProviderKeys)(workspaceId));
      } catch (err) {
        providerError = describeError(err);
      }
    }
    const usable = views ? views.filter((v) => v.source !== "none" && v.status !== "invalid") : [];
    const invalid = views ? views.filter((v) => v.status === "invalid") : [];
    const ready = usable.length > 0 || (!views && envKeys.length > 0);
    items.push({
      id: "providers",
      label: "AI providers",
      status: ready ? (invalid.length ? "warn" : "ok") : "missing",
      hint: ready
        ? `${(views ? usable.map((v) => v.label) : envKeys).join(", ")} ready.${invalid.length ? ` Rejected key: ${invalid.map((v) => v.label).join(", ")}.` : ""}`
        : providerError
          ? `Could not read provider keys (${providerError}).`
          : "Add a fal.ai or Kie.ai key in Settings, Providers (or set FAL_KEY / KIE_API_KEY).",
      docsAnchor: "providers",
    });
  }

  // 9. Storage ------------------------------------------------------------------------------------
  const r2Vars = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
  const r2Set = r2Vars.filter((name) => Boolean(env[name]));
  try {
    const r2 = r2ConfigFromEnv(env);
    items.push(
      r2
        ? { id: "storage", label: "Media storage", status: "ok", hint: `Cloudflare R2 bucket ${r2.bucket}${r2.publicUrl ? " (public URL)" : " (presigned URLs)"}.`, docsAnchor: "storage" }
        : r2Set.length
          ? { id: "storage", label: "Media storage", status: "warn", hint: `R2 is partly configured (missing ${r2Vars.filter((v) => !env[v]).join(", ")}); using Supabase Storage until all four are set.`, docsAnchor: "storage" }
          : { id: "storage", label: "Media storage", status: "ok", hint: "Supabase Storage (free plan: 50 MB per file, 1 GB total). Add Cloudflare R2 for video-heavy use.", docsAnchor: "storage" },
    );
  } catch (err) {
    items.push({ id: "storage", label: "Media storage", status: "warn", hint: err instanceof Error ? err.message : "R2 configuration is invalid.", docsAnchor: "storage" });
  }

  // 10. Reconciler (pg_cron safety net) -------------------------------------------------------------
  if (admin && schemaReady) {
    try {
      const baseUrl = appBaseUrl(source);
      const reconcileSecret = secrets.reconcileSecret;
      const { data, error } = await within(timeoutMs, () =>
        admin.rpc("studio_reconcile_config", { p_expected_base_url: baseUrl, p_expected_secret_sha256: reconcileSecret ? sha256HexSync(reconcileSecret) : null }),
      );
      if (error) throw error;
      items.push(reconcilerItem(data as ReconcileConfig, baseUrl));
    } catch (err) {
      items.push({ id: "reconciler", label: "Background reconciler", status: "warn", hint: `Could not read the reconciler configuration (${describeError(err)}).`, docsAnchor: "reconciler" });
    }
  } else {
    items.push({ id: "reconciler", label: "Background reconciler", status: "warn", hint: "Available once the database schema is up to date.", docsAnchor: "reconciler" });
  }

  // 11. Budget --------------------------------------------------------------------------------------
  const budget = Number(env.MONTHLY_BUDGET_USD ?? 0);
  items.push({
    id: "budget",
    label: "Monthly spend cap",
    status: Number.isFinite(budget) && budget > 0 ? "ok" : "warn",
    hint: Number.isFinite(budget) && budget > 0 ? `Generations stop at $${budget.toFixed(2)} per calendar month.` : "No cap: set MONTHLY_BUDGET_USD (for example 10) so a runaway agent cannot drain your provider balance.",
    docsAnchor: "budget",
  });

  return { ok: items.every((i) => i.status !== "missing"), items, schemaVersion, requiredSchemaVersion: REQUIRED_SCHEMA_VERSION, ownerExists, demoMode };
}

function reconcilerItem(config: ReconcileConfig, baseUrl: string): SetupItem {
  const base = { id: "reconciler" as const, label: "Background reconciler", docsAnchor: "reconciler" };
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(baseUrl);
  if (!config.pg_cron || !config.pg_net) return { ...base, status: "warn", hint: "pg_cron or pg_net is not installed; webhooks and polling still complete jobs, but missed webhooks are only picked up while someone is watching." };
  if (!config.app_base_url || !config.reconcile_secret) {
    return { ...base, status: "warn", hint: "The vault secrets app_base_url and reconcile_secret are missing. A production redeploy with POSTGRES_URL_NON_POOLING writes them; without them missed webhooks are only picked up while someone is watching." };
  }
  if (config.app_base_url_matches === false) return { ...base, status: "warn", hint: `The vault app_base_url does not point at this deployment (${baseUrl}). Redeploy or update the vault secret.` };
  if (config.reconcile_secret_matches === false) return { ...base, status: "warn", hint: "The vault reconcile_secret differs from this deployment's secret, so the reconcile calls are rejected. Redeploy or update the vault secret." };
  if (!config.cron_job) return { ...base, status: "warn", hint: "The reflow-reconcile-every-minute pg_cron job is not scheduled. Re-run supabase/migrations/0002_reconcile_cron.sql." };
  if (local) return { ...base, status: "warn", hint: "pg_cron cannot reach a localhost URL; the reconciler only works on a public deployment." };
  return { ...base, status: "ok", hint: "pg_cron calls the app every minute while jobs are pending." };
}

async function findWorkspaceId(admin: SupabaseClient<Database>, ownerUserId: string | null): Promise<string | null> {
  if (ownerUserId) {
    const { data } = await admin.from("workspace_members").select("workspace_id").eq("user_id", ownerUserId).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  const { data } = await admin.from("workspaces").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data?.id ?? null;
}
