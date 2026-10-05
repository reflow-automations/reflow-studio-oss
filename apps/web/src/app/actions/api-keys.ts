"use server";

import { revalidatePath } from "next/cache";
import { createApiKey, revokeApiKey } from "@/lib/auth/api-keys";
import { workspaceForUser } from "@/lib/auth/principal";
import { currentUser } from "@/lib/supabase/server";

const ALLOWED_SCOPES = new Set(["generate", "read"]);

export interface CreateApiKeyState {
  error?: string;
  secret?: string;
  key?: { id: string; name: string; prefix: string; scopes: string[] };
}

export async function createApiKeyAction(_prev: CreateApiKeyState, formData: FormData): Promise<CreateApiKeyState> {
  const user = await currentUser();
  if (!user) return { error: "You are signed out. Reload and sign in again." };
  const workspace = await workspaceForUser(user.id);
  if (!workspace) return { error: "No workspace is attached to your account yet." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 80) return { error: "Give the key a name (1–80 characters)." };
  const scopes = formData
    .getAll("scopes")
    .map(String)
    .filter((s) => ALLOWED_SCOPES.has(s));
  if (scopes.length === 0) return { error: "Select at least one scope." };
  const expiresRaw = String(formData.get("expires_in_days") ?? "").trim();
  const expiresInDays = expiresRaw ? Number(expiresRaw) : 0;
  if (!Number.isFinite(expiresInDays) || expiresInDays < 0 || expiresInDays > 3650) return { error: "Expiry must be between 0 and 3650 days." };
  const expiresAt = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;

  try {
    const { secret, key } = await createApiKey({ workspaceId: workspace.id, userId: user.id, name, scopes, expiresAt });
    revalidatePath("/settings/api-keys");
    return { secret, key: { id: key.id, name: key.name, prefix: key.prefix, scopes: key.scopes } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the key." };
  }
}

export interface RevokeApiKeyState {
  error?: string;
}

export async function revokeApiKeyAction(_prev: RevokeApiKeyState, formData: FormData): Promise<RevokeApiKeyState> {
  const user = await currentUser();
  if (!user) return { error: "You are signed out." };
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid key id." };
  try {
    await revokeApiKey(id, user.id);
    revalidatePath("/settings/api-keys");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not revoke the key." };
  }
}
