import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerEmails } from "@/lib/auth/owner";
import type { Database } from "@/lib/db/types";
import { withoutEmpty, type EnvSource } from "@/lib/env";
import { looksLikePlaceholder, resolveSecrets, safeEqual } from "@/lib/secrets";
import { isMissingFunctionError, listAuthEmails, setupAdminClient } from "@/lib/setup/status";

/**
 * First-owner bootstrap without e-mail. Supabase's built-in mailer only reaches
 * the project's own team at 2 mails an hour, so /setup creates the owner
 * directly through the Auth admin API instead of a sign-up or magic link.
 *
 * Guard rails:
 * - works only while no account exists for an OWNER_EMAILS address;
 * - the caller must know the deploy secret (REFLOW_SECRET, or WEBHOOK_SECRET on
 *   deployments configured before REFLOW_SECRET existed), compared in constant time;
 * - the e-mail must be on OWNER_EMAILS (required in production);
 * - repeated wrong secrets are throttled per client key and per instance.
 * The database allowlist (private.allowed_emails) is synced from OWNER_EMAILS
 * first, because its trigger refuses every other new auth user.
 */

export type FirstOwnerErrorCode = "invalid_input" | "invalid_secret" | "not_configured" | "not_allowed" | "owner_exists" | "rate_limited" | "failed";

export type CreateFirstOwnerResult =
  | { ok: true; userId: string; email: string }
  | {
      ok: false;
      code: FirstOwnerErrorCode;
      /** Safe to show to the visitor; never contains secrets. */
      message: string;
      /** Suggested HTTP status for a route handler or server action. */
      status: number;
      /** Set with code "rate_limited". */
      retryAfterSeconds?: number;
    };

export interface CreateFirstOwnerInput {
  email: string;
  password: string;
  /** What the visitor typed as the deploy secret. */
  setupSecret: string;
  /** Throttle key, e.g. the client IP from x-forwarded-for. */
  clientKey?: string;
}

export interface FirstOwnerDeps {
  /** Defaults to process.env. */
  env?: EnvSource;
  /** Service-role client; defaults to one built from the environment. */
  admin?: SupabaseClient<Database> | null;
  /** Clock in ms (tests). */
  now?: () => number;
}

export const MIN_OWNER_PASSWORD_LENGTH = 8;
/** bcrypt (Supabase Auth) only uses the first 72 bytes. */
export const MAX_OWNER_PASSWORD_LENGTH = 72;

const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_CLIENT = 5;
const MAX_FAILURES_PER_INSTANCE = 25;
const failures = new Map<string, number[]>();

function recentFailures(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
  failures.set(key, list);
  return list;
}

function throttled(clientKey: string, now: number): number | null {
  const client = recentFailures(`client:${clientKey}`, now);
  const instance = recentFailures("instance", now);
  const blocking = client.length >= MAX_FAILURES_PER_CLIENT ? client : instance.length >= MAX_FAILURES_PER_INSTANCE ? instance : null;
  if (!blocking) return null;
  return Math.max(1, Math.ceil((blocking[0]! + FAILURE_WINDOW_MS - now) / 1000));
}

function recordFailure(clientKey: string, now: number): void {
  recentFailures(`client:${clientKey}`, now).push(now);
  recentFailures("instance", now).push(now);
}

/** Test hook: forget throttling state. */
export function resetFirstOwnerThrottle(): void {
  failures.clear();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code: FirstOwnerErrorCode, message: string, status: number, retryAfterSeconds?: number): CreateFirstOwnerResult {
  return retryAfterSeconds === undefined ? { ok: false, code, message, status } : { ok: false, code, message, status, retryAfterSeconds };
}

/** True when an account exists for an OWNER_EMAILS address (any account when the list is empty outside production). */
export async function ownerAccountExists(deps: FirstOwnerDeps = {}): Promise<boolean> {
  const source = deps.env ?? process.env;
  const admin = deps.admin === undefined ? setupAdminClient(source) : deps.admin;
  if (!admin) return false;
  const owners = ownerEmails(source);
  const users = await listAuthEmails(admin);
  if (owners.length) return users.some((u) => owners.includes(u.email));
  return source.NODE_ENV === "production" ? false : users.length > 0;
}

export async function createFirstOwner(input: CreateFirstOwnerInput, deps: FirstOwnerDeps = {}): Promise<CreateFirstOwnerResult> {
  const source = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();
  const clientKey = input.clientKey?.trim() || "anonymous";

  const wait = throttled(clientKey, now);
  if (wait !== null) return fail("rate_limited", `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, 429, wait);

  const email = String(input.email ?? "").trim().toLowerCase();
  const password = String(input.password ?? "");
  const typedSecret = String(input.setupSecret ?? "").trim();
  if (!EMAIL.test(email)) return fail("invalid_input", "Enter a valid e-mail address.", 400);
  if (password.length < MIN_OWNER_PASSWORD_LENGTH) return fail("invalid_input", `Use a password of at least ${MIN_OWNER_PASSWORD_LENGTH} characters.`, 400);
  if (password.length > MAX_OWNER_PASSWORD_LENGTH) return fail("invalid_input", `Use a password of at most ${MAX_OWNER_PASSWORD_LENGTH} characters.`, 400);
  if (!typedSecret) return fail("invalid_input", "Enter the deploy secret (REFLOW_SECRET).", 400);

  const env = withoutEmpty(source);
  const expected = resolveSecrets(env).setupSecret;
  if (!expected || looksLikePlaceholder(expected)) return fail("not_configured", "This deployment has no REFLOW_SECRET yet. Set it in the environment and redeploy.", 503);
  if (!safeEqual(typedSecret, expected)) {
    recordFailure(clientKey, now);
    return fail("invalid_secret", "The deploy secret is not correct.", 401);
  }

  const owners = ownerEmails(env).filter((e) => !looksLikePlaceholder(e));
  if (owners.length === 0 && source.NODE_ENV === "production") return fail("not_configured", "Set OWNER_EMAILS to your e-mail address and redeploy first.", 503);
  if (owners.length > 0 && !owners.includes(email)) return fail("not_allowed", "This e-mail address is not in OWNER_EMAILS.", 403);

  const admin = deps.admin === undefined ? setupAdminClient(source) : deps.admin;
  if (!admin) return fail("not_configured", "Supabase is not configured yet (see the checklist above).", 503);

  let users: Array<{ id: string; email: string }>;
  try {
    users = await listAuthEmails(admin);
  } catch {
    return fail("failed", "Could not reach Supabase Auth. Check the Supabase URL and secret key.", 502);
  }
  const existing = owners.length ? users.find((u) => owners.includes(u.email)) : users[0];
  if (existing) return fail("owner_exists", "An owner account already exists. Sign in on /login.", 409);

  const { error: syncError } = await admin.rpc("sync_allowed_emails", { p_emails: owners.length ? owners : [email] });
  if (syncError) {
    return isMissingFunctionError(syncError)
      ? fail("not_configured", "The database migrations are not applied yet (see the checklist above).", 503)
      : fail("failed", "Could not update the sign-up allowlist in the database.", 500);
  }

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "email_exists" || code === "user_already_exists") return fail("owner_exists", "An account with this e-mail already exists. Sign in on /login.", 409);
    if (code === "weak_password") return fail("invalid_input", error?.message || "The password is too weak.", 400);
    return fail("failed", "Supabase refused to create the account. Check the database migrations on this page.", 500);
  }

  await ensureOwnerMembership(admin, data.user.id, email);
  failures.delete(`client:${clientKey}`);
  return { ok: true, userId: data.user.id, email };
}

/**
 * The handle_new_user trigger normally adds the new account to the 'default'
 * workspace as owner. Repair it here when the trigger is missing (for example
 * an account created before the migrations ran).
 */
async function ensureOwnerMembership(admin: SupabaseClient<Database>, userId: string, email: string): Promise<void> {
  try {
    const { data: membership } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
    if (membership) return;
    let { data: workspace } = await admin.from("workspaces").select("id").eq("slug", "default").maybeSingle();
    if (!workspace) {
      const created = await admin.from("workspaces").insert({ slug: "default", name: "Reflow Studio" }).select("id").single();
      workspace = created.data;
    }
    if (!workspace) return;
    await admin.from("profiles").upsert({ id: userId, email, display_name: email.split("@")[0] ?? null }, { onConflict: "id" });
    await admin.from("workspace_members").insert({ workspace_id: workspace.id, user_id: userId, role: "owner" });
  } catch {
    // Best effort: the shell explains a missing workspace, and /setup shows the schema state.
  }
}
