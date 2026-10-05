import "server-only";
import { PAID_PROVIDER_IDS, type PaidProviderId, type ProviderId } from "@reflow/core";
import type { ProviderKeyRow, ProviderKeyStatus } from "@/lib/db/types";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret, keyHint, parseMasterKey } from "@/lib/settings/crypto";
import { invalidateRouter } from "@/lib/studio/router-cache";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Provider API keys entered in the app (Settings → Providers), encrypted at
 * rest with AES-256-GCM. Environment variables (`FAL_KEY`, `KIE_API_KEY`)
 * remain a fallback so a deployment can also be configured without the UI.
 */

export type KeyProvider = Extract<ProviderId, "fal" | "kie" | "higgsfield">;

export interface KeyProviderInfo {
  id: KeyProvider;
  label: string;
  help: string;
  helpUrl: string;
  envVar: "FAL_KEY" | "KIE_API_KEY" | "HIGGSFIELD_API_CREDENTIAL";
}

export const KEY_PROVIDERS: readonly KeyProviderInfo[] = [
  { id: "fal", label: "fal.ai", help: "Create a key under Dashboard → Keys. Used with `Authorization: Key …`.", helpUrl: "https://fal.ai/dashboard/keys", envVar: "FAL_KEY" },
  { id: "kie", label: "Kie.ai", help: "Copy the API key from your Kie.ai account (API Key page). Credits are prepaid.", helpUrl: "https://kie.ai/api-key", envVar: "KIE_API_KEY" },
  { id: "higgsfield", label: "Higgsfield API", help: "Use the separate API account. Paste key ID and secret together as ID:SECRET. This uses the API dollar balance, not plan credits.", helpUrl: "https://console.higgsfield.ai", envVar: "HIGGSFIELD_API_CREDENTIAL" },
];

export function isKeyProvider(value: string): value is KeyProvider {
  return KEY_PROVIDERS.some((p) => p.id === value);
}

export type ProviderPreference = "cheapest" | PaidProviderId;
export const PROVIDER_PREFERENCES: readonly ProviderPreference[] = ["cheapest", ...PAID_PROVIDER_IDS];

export interface ProviderKeyView {
  provider: KeyProvider;
  label: string;
  help: string;
  help_url: string;
  /** Where the active key comes from: saved in the app, the environment, or nowhere. */
  source: "app" | "env" | "none";
  key_hint: string | null;
  status: ProviderKeyStatus | null;
  last_tested_at: string | null;
  last_error: string | null;
}

type ProbeResult = { ok: boolean; error?: string };

function aad(workspaceId: string, provider: KeyProvider): string {
  return `${workspaceId}:${provider}`;
}

function masterKey(): Uint8Array {
  return parseMasterKey(env().KEY_ENCRYPTION_SECRET);
}

/** True when a usable encryption key exists (KEY_ENCRYPTION_SECRET, or derived from REFLOW_SECRET). */
export function encryptionConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

async function audit(workspaceId: string, provider: KeyProvider, action: "create" | "rotate" | "test" | "delete", actorId: string | null, detail?: string): Promise<void> {
  await supabaseAdmin().from("provider_key_events").insert({ workspace_id: workspaceId, provider, action, actor_id: actorId, detail: detail ?? null });
}

async function getRow(workspaceId: string, provider: KeyProvider): Promise<ProviderKeyRow | null> {
  const { data } = await supabaseAdmin().from("provider_keys").select("*").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle();
  return data ?? null;
}

async function setStatus(workspaceId: string, provider: KeyProvider, status: ProviderKeyStatus, error: string | undefined, actorId: string | null): Promise<void> {
  await supabaseAdmin().from("provider_keys").update({ status, last_tested_at: new Date().toISOString(), last_error: error ?? null }).eq("workspace_id", workspaceId).eq("provider", provider);
  await audit(workspaceId, provider, "test", actorId, status);
}

/** Hint + status per provider; never the ciphertext. */
export async function listProviderKeys(workspaceId: string): Promise<ProviderKeyView[]> {
  const { data } = await supabaseAdmin().from("provider_keys").select("provider, key_hint, status, last_tested_at, last_error").eq("workspace_id", workspaceId);
  const rows = new Map((data ?? []).map((r) => [r.provider, r]));
  const e = env();
  return KEY_PROVIDERS.map((p) => {
    const row = rows.get(p.id);
    const envKey = e[p.envVar];
    return {
      provider: p.id,
      label: p.label,
      help: p.help,
      help_url: p.helpUrl,
      source: row ? "app" : envKey ? "env" : "none",
      key_hint: row ? row.key_hint : envKey ? keyHint(envKey) : null,
      status: row ? row.status : envKey ? "untested" : null,
      last_tested_at: row?.last_tested_at ?? null,
      last_error: row?.last_error ?? null,
    };
  });
}

/** Encrypt, store and immediately test a key. */
export async function saveProviderKey(workspaceId: string, provider: KeyProvider, secret: string, actorId: string | null): Promise<{ status: ProviderKeyStatus; error?: string }> {
  const trimmed = secret.trim();
  if (trimmed.length < 8) throw new Error("That does not look like a valid key.");
  const encrypted = await encryptSecret(trimmed, aad(workspaceId, provider), masterKey());
  const admin = supabaseAdmin();
  const existing = await getRow(workspaceId, provider);
  const { error } = await admin
    .from("provider_keys")
    .upsert({ workspace_id: workspaceId, provider, ciphertext: encrypted.ciphertext, iv: encrypted.iv, key_hint: keyHint(trimmed), status: "untested", last_error: null, created_by: actorId }, { onConflict: "workspace_id,provider" });
  if (error) throw new Error(`could not store the key: ${error.message}`);
  await audit(workspaceId, provider, existing ? "rotate" : "create", actorId);
  invalidateRouter(workspaceId);
  const result = await testProvider(provider, trimmed);
  await setStatus(workspaceId, provider, result.ok ? "valid" : "invalid", result.error, actorId);
  return { status: result.ok ? "valid" : "invalid", error: result.error };
}

/** Re-test a stored key (or the environment key when nothing is stored). */
export async function testProviderKey(workspaceId: string, provider: KeyProvider, actorId: string | null): Promise<{ status: ProviderKeyStatus; error?: string }> {
  const row = await getRow(workspaceId, provider);
  if (!row) {
    const envKey = env()[KEY_PROVIDERS.find((p) => p.id === provider)!.envVar];
    if (!envKey) throw new Error("No key stored for this provider.");
    const result = await testProvider(provider, envKey);
    return { status: result.ok ? "valid" : "invalid", error: result.error };
  }
  let secret: string;
  try {
    secret = await decryptSecret({ ciphertext: row.ciphertext, iv: row.iv }, aad(workspaceId, provider), masterKey());
  } catch {
    // Stored under a different KEY_ENCRYPTION_SECRET (e.g. copied between environments): re-entering is the only fix.
    const error = "This key was encrypted with a different KEY_ENCRYPTION_SECRET (or REFLOW_SECRET) than this deployment uses. Paste it again.";
    await setStatus(workspaceId, provider, "invalid", error, actorId);
    return { status: "invalid", error };
  }
  const result = await testProvider(provider, secret);
  await setStatus(workspaceId, provider, result.ok ? "valid" : "invalid", result.error, actorId);
  return { status: result.ok ? "valid" : "invalid", error: result.error };
}

export async function removeProviderKey(workspaceId: string, provider: KeyProvider, actorId: string | null): Promise<void> {
  const { error } = await supabaseAdmin().from("provider_keys").delete().eq("workspace_id", workspaceId).eq("provider", provider);
  if (error) throw new Error(`could not remove the key: ${error.message}`);
  await audit(workspaceId, provider, "delete", actorId);
  invalidateRouter(workspaceId);
}

/**
 * Plain secrets for building provider adapters: app-stored keys first, then
 * environment variables. Undecryptable rows are skipped (the status shows why).
 */
export async function resolveProviderSecrets(workspaceId: string): Promise<Record<KeyProvider, string | undefined>> {
  const e = env();
  const out: Record<KeyProvider, string | undefined> = { fal: e.FAL_KEY, kie: e.KIE_API_KEY, higgsfield: e.HIGGSFIELD_API_CREDENTIAL };
  const { data } = await supabaseAdmin().from("provider_keys").select("provider, ciphertext, iv, status").eq("workspace_id", workspaceId);
  if (!data?.length) return out;
  let master: Uint8Array | undefined;
  try {
    master = masterKey();
  } catch {
    return out;
  }
  for (const row of data) {
    if (!isKeyProvider(row.provider)) continue;
    // A key that failed its last test is skipped so routing falls back to the other provider (or the env key).
    if (row.status === "invalid") continue;
    try {
      out[row.provider] = await decryptSecret({ ciphertext: row.ciphertext, iv: row.iv }, aad(workspaceId, row.provider), master);
    } catch {
      // leave the environment fallback in place
    }
  }
  return out;
}

export async function getProviderPreference(workspaceId: string): Promise<ProviderPreference> {
  const { data } = await supabaseAdmin().from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const value = (data?.settings as { provider_preference?: string } | null)?.provider_preference;
  return value === "fal" || value === "kie" || value === "higgsfield" ? value : "cheapest";
}

export async function setProviderPreference(workspaceId: string, preference: ProviderPreference): Promise<void> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown> | null) ?? {}), provider_preference: preference };
  const { error } = await admin.from("workspaces").update({ settings }).eq("id", workspaceId);
  if (error) throw new Error(`could not save the preference: ${error.message}`);
  invalidateRouter(workspaceId);
}

// ---------------------------------------------------------------------------
// Probes: the cheapest call that proves a key works
// ---------------------------------------------------------------------------

async function probe(url: string, init: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.ok) {
      // Kie returns 200 with a body code for auth failures.
      if (url.includes("kie.ai")) {
        const body = (await res.json().catch(() => null)) as { code?: number; msg?: string } | null;
        if (body && typeof body.code === "number" && body.code !== 200) return { ok: false, error: `Kie rejected the key (${body.code}${body.msg ? `: ${body.msg}` : ""})` };
      }
      return { ok: true };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Key rejected (HTTP ${res.status})` };
    return { ok: false, error: `Unexpected response: HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

export async function testProvider(provider: KeyProvider, key: string): Promise<ProbeResult> {
  switch (provider) {
    case "fal":
      return probe("https://api.fal.ai/v1/models?limit=1", { headers: { authorization: `Key ${key}` } });
    case "kie":
      return probe("https://api.kie.ai/api/v1/chat/credit", { headers: { authorization: `Bearer ${key}` } });
    case "higgsfield": {
      const split = key.indexOf(":");
      if (split <= 0 || split === key.length - 1) return { ok: false, error: "Paste Higgsfield API credentials as KEY_ID:KEY_SECRET." };
      return probe("https://api.higgsfield.ai/estimate/higgsfield-ai/soul/v2/standard", { method: "POST", headers: { authorization: `Key ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: "Credential check" }) });
    }
    default:
      return { ok: false, error: "unknown provider" };
  }
}
