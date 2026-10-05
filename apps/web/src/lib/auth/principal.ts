import "server-only";
import { StudioError } from "@reflow/core";
import { hasScope, verifyApiKey, type ApiScope } from "@/lib/auth/api-keys";
import { isOwnerEmail } from "@/lib/auth/owner";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import type { Principal } from "@/lib/studio/service";

export type { ApiScope } from "@/lib/auth/api-keys";

export interface ResolvedPrincipal extends Principal {
  via: "session" | "api_key";
  scopes: string[];
  email?: string | null;
}

/** Workspace of a user (single tenant: the first membership). */
export async function workspaceForUser(userId: string): Promise<{ id: string; slug: string; name: string; role: string } | null> {
  const { data } = await supabaseAdmin()
    .from("workspace_members")
    .select("role, workspaces!inner(id, slug, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const ws = (data as unknown as { role: string; workspaces: { id: string; slug: string; name: string } }).workspaces;
  return { id: ws.id, slug: ws.slug, name: ws.name, role: (data as { role: string }).role };
}

/** Resolve the caller from a bearer API key or the Supabase cookie session. */
export async function resolvePrincipal(request: Request): Promise<ResolvedPrincipal | null> {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const key = await verifyApiKey(auth.slice(7).trim());
    if (!key) return null;
    return { via: "api_key", workspaceId: key.workspaceId, userId: key.userId, apiKeyId: key.apiKeyId, scopes: key.scopes };
  }
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (!isOwnerEmail(user.email)) throw new StudioError("unauthorized", "this account is not allowed to use this studio", { status: 403 });
  const ws = await workspaceForUser(user.id);
  if (!ws) return null;
  return { via: "session", workspaceId: ws.id, userId: user.id, scopes: ["generate", "read", "admin"], email: user.email };
}

/**
 * Throw a 403 StudioError unless `subject` holds `scope` (`admin` grants every
 * scope). Accepts a principal or a bare scope list, so the MCP server can pass
 * the scopes it received in `authInfo`.
 */
export function requireScope(subject: { scopes?: readonly string[] | null } | readonly string[] | null | undefined, scope: ApiScope): void {
  const scopes = Array.isArray(subject) ? (subject as readonly string[]) : (subject as { scopes?: readonly string[] | null } | null | undefined)?.scopes;
  if (!hasScope(scopes, scope)) throw new StudioError("unauthorized", `missing scope ${scope}`, { status: 403 });
}

export async function requirePrincipal(request: Request, scope?: ApiScope): Promise<ResolvedPrincipal> {
  const principal = await resolvePrincipal(request);
  if (!principal) throw new StudioError("unauthorized", "authentication required (Supabase session or Bearer API key)");
  if (scope) requireScope(principal, scope);
  return principal;
}
