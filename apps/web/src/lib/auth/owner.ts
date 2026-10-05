/**
 * Owner allowlist. The studio is a personal deployment: only the e-mail
 * addresses in `OWNER_EMAILS` may sign in or hold API keys. Pure functions so
 * they can run in proxy.ts (Edge) and tests alike.
 */

export type OwnerCheck = { allowed: true } | { allowed: false; reason: "not_allowed" | "owner_list_missing" };

export function ownerEmails(env: Record<string, string | undefined> = process.env): string[] {
  return (env.OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Allowed when the e-mail is on the list. With an empty list, development
 * stays open (so `pnpm dev` works before configuration) while production fails
 * closed — a personal deployment must never be open to anyone with a Supabase
 * account.
 */
export function checkOwner(email: string | null | undefined, env: Record<string, string | undefined> = process.env): OwnerCheck {
  const list = ownerEmails(env);
  if (list.length === 0) {
    return env.NODE_ENV === "production" ? { allowed: false, reason: "owner_list_missing" } : { allowed: true };
  }
  const normalized = email?.trim().toLowerCase();
  return normalized && list.includes(normalized) ? { allowed: true } : { allowed: false, reason: "not_allowed" };
}

export function isOwnerEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  return checkOwner(email, env).allowed;
}

/** Whether the login page should offer account creation. */
export function signupEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ALLOW_SIGNUP === "true" || ownerEmails(env).length === 0;
}

export function ownerDeniedMessage(reason: "not_allowed" | "owner_list_missing"): string {
  return reason === "owner_list_missing"
    ? "This deployment has no OWNER_EMAILS configured. Set it in the environment to sign in."
    : "This account is not allowed to use this studio.";
}
