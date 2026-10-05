import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomToken, sha256Hex } from "@reflow/core";
import { isOwnerEmail } from "@/lib/auth/owner";
import type { Database } from "@/lib/db/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const API_KEY_PREFIX = "rfl_";

/**
 * Scopes an API key (or session) can hold. `read` lists and inspects, `generate`
 * spends money or writes (generations, uploads, imports, routing, shares) and
 * `admin` implies both. Sessions of an allowed owner get all three.
 */
export const API_SCOPES = ["read", "generate", "admin"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
/** Scopes a new key gets when none are chosen. */
export const DEFAULT_API_KEY_SCOPES: readonly ApiScope[] = ["generate", "read"];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Whether `scopes` grant `scope` (`admin` grants everything). */
export function hasScope(scopes: readonly string[] | null | undefined, scope: ApiScope): boolean {
  if (!scopes) return false;
  return scopes.includes(scope) || scopes.includes("admin");
}

export interface ApiKeyPrincipal {
  apiKeyId: string;
  workspaceId: string;
  userId: string;
  scopes: string[];
  name: string;
}

/** Create a new API key; the secret is returned exactly once. */
export async function createApiKey(input: { workspaceId: string; userId: string; name: string; scopes?: string[]; expiresAt?: string | null }) {
  const secret = `${API_KEY_PREFIX}${randomToken(32)}`;
  const keyHash = await sha256Hex(secret);
  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      name: input.name,
      prefix: secret.slice(0, 12),
      key_hash: keyHash,
      scopes: input.scopes ?? [...DEFAULT_API_KEY_SCOPES],
      expires_at: input.expiresAt ?? null,
    })
    .select("id, name, prefix, scopes, created_at, expires_at")
    .single();
  if (error) throw new Error(`could not create api key: ${error.message}`);
  return { secret, key: data };
}

/** `last_used_at` is written at most this often per key, so polling clients do not cause a write per request. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;
/** Auth e-mail lookups are cached briefly per instance; OWNER_EMAILS itself is read on every call. */
const EMAIL_CACHE_TTL_MS = 60 * 1000;
const emailCache = new Map<string, { email: string | null; expires: number }>();

/** The e-mail of the Supabase Auth user (not `profiles.email`, which users could edit before migration 0007). */
async function authEmail(admin: SupabaseClient<Database>, userId: string, now: number): Promise<string | null> {
  const hit = emailCache.get(userId);
  if (hit && hit.expires > now) return hit.email;
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error && !data?.user) return null;
  const email = data.user?.email ?? null;
  if (emailCache.size > 500) emailCache.clear();
  emailCache.set(userId, { email, expires: now + EMAIL_CACHE_TTL_MS });
  return email;
}

/** Test hook: forget cached auth e-mails. */
export function clearApiKeyCaches(): void {
  emailCache.clear();
}

/** Resolve a bearer secret to its principal, or null when unknown/revoked/expired. */
export async function verifyApiKey(secret: string | undefined | null, options: { admin?: SupabaseClient<Database>; now?: () => Date } = {}): Promise<ApiKeyPrincipal | null> {
  if (!secret || !secret.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = await sha256Hex(secret.trim());
  const admin = options.admin ?? supabaseAdmin();
  const now = (options.now ?? (() => new Date()))().getTime();
  const { data } = await admin
    .from("api_keys")
    .select("id, workspace_id, user_id, scopes, name, expires_at, revoked_at, last_used_at")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < now) return null;
  // A key stops working the moment its owner leaves the allowlist.
  if (!isOwnerEmail(await authEmail(admin, data.user_id, now))) return null;
  if (!data.last_used_at || now - new Date(data.last_used_at).getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await admin.from("api_keys").update({ last_used_at: new Date(now).toISOString() }).eq("id", data.id);
  }
  return { apiKeyId: data.id, workspaceId: data.workspace_id, userId: data.user_id, scopes: data.scopes, name: data.name };
}

export async function revokeApiKey(id: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(error.message);
}
