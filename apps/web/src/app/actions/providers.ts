"use server";

import { revalidatePath } from "next/cache";
import { workspaceForUser } from "@/lib/auth/principal";
import { appBaseUrl } from "@/lib/env";
import { isKeyProvider, PROVIDER_PREFERENCES, removeProviderKey, saveProviderKey, setProviderPreference, testProviderKey, type ProviderPreference } from "@/lib/settings/provider-keys";
import { getStorage, R2StorageBackend } from "@/lib/storage";
import { currentUser } from "@/lib/supabase/server";

export interface ProviderKeyState {
  provider?: string;
  status?: "valid" | "invalid" | "untested";
  message?: string;
  error?: string;
}

async function context(): Promise<{ userId: string; workspaceId: string } | { error: string }> {
  const user = await currentUser();
  if (!user) return { error: "You are signed out. Reload and sign in again." };
  const workspace = await workspaceForUser(user.id);
  if (!workspace) return { error: "No workspace is attached to your account yet." };
  return { userId: user.id, workspaceId: workspace.id };
}

function providerFrom(formData: FormData): string | null {
  const provider = String(formData.get("provider") ?? "");
  return isKeyProvider(provider) ? provider : null;
}

export async function saveProviderKeyAction(_prev: ProviderKeyState, formData: FormData): Promise<ProviderKeyState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const provider = providerFrom(formData);
  if (!provider || !isKeyProvider(provider)) return { error: "Unknown provider." };
  const secret = String(formData.get("secret") ?? "");
  try {
    const result = await saveProviderKey(ctx.workspaceId, provider, secret, ctx.userId);
    revalidatePath("/settings/providers");
    return { provider, status: result.status, message: result.status === "valid" ? "Key saved and verified." : "Key saved, but the test failed.", error: result.error };
  } catch (err) {
    return { provider, error: err instanceof Error ? err.message : "Could not save the key." };
  }
}

export async function testProviderKeyAction(_prev: ProviderKeyState, formData: FormData): Promise<ProviderKeyState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const provider = providerFrom(formData);
  if (!provider || !isKeyProvider(provider)) return { error: "Unknown provider." };
  try {
    const result = await testProviderKey(ctx.workspaceId, provider, ctx.userId);
    revalidatePath("/settings/providers");
    return { provider, status: result.status, message: result.status === "valid" ? "The key works." : "The key was rejected.", error: result.error };
  } catch (err) {
    return { provider, error: err instanceof Error ? err.message : "Could not test the key." };
  }
}

export async function removeProviderKeyAction(_prev: ProviderKeyState, formData: FormData): Promise<ProviderKeyState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const provider = providerFrom(formData);
  if (!provider || !isKeyProvider(provider)) return { error: "Unknown provider." };
  try {
    await removeProviderKey(ctx.workspaceId, provider, ctx.userId);
    revalidatePath("/settings/providers");
    return { provider, message: "Key removed. The environment variable (if any) is used again." };
  } catch (err) {
    return { provider, error: err instanceof Error ? err.message : "Could not remove the key." };
  }
}

export interface PreferenceState {
  error?: string;
  message?: string;
}

export async function setProviderPreferenceAction(_prev: PreferenceState, formData: FormData): Promise<PreferenceState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const preference = String(formData.get("preference") ?? "");
  if (!PROVIDER_PREFERENCES.includes(preference as ProviderPreference)) return { error: "Unknown preference." };
  try {
    await setProviderPreference(ctx.workspaceId, preference as ProviderPreference);
    revalidatePath("/settings/providers");
    return { message: `Routing preference set to "${preference}".` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the preference." };
  }
}

export interface StorageActionState {
  error?: string;
  message?: string;
}

/** R2 only: allow browser uploads/downloads from this deployment's origin, merged into the bucket's existing CORS rules. */
export async function applyStorageCorsAction(): Promise<StorageActionState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const storage = getStorage();
  if (!(storage instanceof R2StorageBackend)) return { error: "CORS only applies to the R2 backend." };
  const origins = [appBaseUrl(), "http://localhost:3000"];
  try {
    const { kept } = await storage.setCors(origins);
    return { message: `CORS rule applied for ${origins.join(", ")}; kept ${kept} existing rule${kept === 1 ? "" : "s"}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update CORS." };
  }
}

export async function testStorageAction(): Promise<StorageActionState> {
  const ctx = await context();
  if ("error" in ctx) return { error: ctx.error };
  const storage = getStorage();
  if (!(storage instanceof R2StorageBackend)) return { message: "Supabase Storage is in use (R2 is not configured)." };
  const result = await storage.probe();
  return result.ok ? { message: `Connected to bucket "${storage.bucket}".` } : { error: `R2 check failed: ${result.error}` };
}
