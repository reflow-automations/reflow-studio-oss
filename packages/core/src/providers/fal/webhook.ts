import * as ed from "@noble/ed25519";
import type { FetchLike } from "../types";
import { base64UrlToBytes, hexToBytes, sha256Hex, utf8 } from "../../util/crypto";
import { requestJson } from "../../util/http";

/**
 * fal.ai webhook signature verification.
 *
 * Headers: X-Fal-Webhook-Request-Id, X-Fal-Webhook-User-Id,
 * X-Fal-Webhook-Timestamp (unix seconds), X-Fal-Webhook-Signature (hex ED25519).
 * Message = request_id + "\n" + user_id + "\n" + timestamp + "\n" + sha256_hex(raw_body).
 * Public keys are published as a JWKS (keys[].x = base64url ED25519 public key).
 * Verified against fal-js / fal-client sources and community verifiers (Sept 2026).
 */

export const FAL_JWKS_URLS = ["https://rest.alpha.fal.ai/.well-known/jwks.json", "https://rest.fal.ai/.well-known/jwks.json"] as const;

export interface FalWebhookHeaders {
  requestId: string;
  userId: string;
  timestamp: string;
  signature: string;
}

export interface JwksCache {
  keys: Uint8Array[];
  fetchedAt: number;
}

export interface VerifyOptions {
  fetch: FetchLike;
  jwksUrls?: readonly string[];
  /** Cache holder shared across invocations (module-level or per-adapter). */
  cache?: { current?: JwksCache };
  cacheTtlMs?: number;
  /**
   * When no cached key verifies a signature and the cache is at least this old,
   * refetch the JWKS once and retry (fal rotated its keys). Default 5 minutes.
   */
  refreshOnMissAfterMs?: number;
  toleranceSeconds?: number;
  now?: () => number;
}

/** Load fal's webhook public keys, from the cache while it is fresh (or always when `force` is set, refetch). */
export async function loadFalJwks(options: VerifyOptions, force = false): Promise<Uint8Array[]> {
  const ttl = options.cacheTtlMs ?? 24 * 60 * 60 * 1000;
  const now = options.now?.() ?? Date.now();
  const cached = options.cache?.current;
  if (cached && !force && now - cached.fetchedAt < ttl) return cached.keys;
  let lastError: unknown;
  for (const url of options.jwksUrls ?? FAL_JWKS_URLS) {
    try {
      const response = await requestJson<{ keys?: Array<{ x?: string; kty?: string; crv?: string }> }>(options.fetch, url, { timeoutMs: 10_000 });
      if (!response.ok || !response.json?.keys) continue;
      const keys = response.json.keys
        .filter((k) => typeof k.x === "string" && (k.crv === undefined || k.crv === "Ed25519"))
        .map((k) => base64UrlToBytes(k.x as string));
      if (keys.length === 0) continue;
      if (options.cache) options.cache.current = { keys, fetchedAt: now };
      return keys;
    } catch (error) {
      lastError = error;
    }
  }
  if (cached) return cached.keys; // stale cache beats nothing
  throw lastError instanceof Error ? lastError : new Error("could not load fal JWKS");
}

export function buildFalSignedMessage(headers: FalWebhookHeaders, bodySha256Hex: string): string {
  return `${headers.requestId}\n${headers.userId}\n${headers.timestamp}\n${bodySha256Hex}`;
}

/** Verify a fal webhook. Returns false for any malformed input; never throws on bad signatures. */
export async function verifyFalWebhook(headers: FalWebhookHeaders, rawBody: string, options: VerifyOptions): Promise<boolean> {
  const tolerance = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > tolerance) return false;
  let signature: Uint8Array;
  try {
    signature = hexToBytes(headers.signature);
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  const message = utf8(buildFalSignedMessage(headers, await sha256Hex(rawBody)));
  let keys: Uint8Array[];
  try {
    keys = await loadFalJwks(options);
  } catch {
    return false;
  }
  if (await anyKeyVerifies(signature, message, keys)) return true;
  // fal may have rotated its keys since the cache was filled: refetch once,
  // but not more often than every few minutes (forged webhooks must not turn
  // into a JWKS request each).
  const cached = options.cache?.current;
  const now = options.now?.() ?? Date.now();
  if (!cached || now - cached.fetchedAt < (options.refreshOnMissAfterMs ?? 5 * 60 * 1000)) return false;
  let fresh: Uint8Array[];
  try {
    fresh = await loadFalJwks(options, true);
  } catch {
    return false;
  }
  if (fresh === keys) return false; // refetch failed and returned the stale cache
  return anyKeyVerifies(signature, message, fresh.filter((key) => !keys.some((old) => sameBytes(old, key))));
}

async function anyKeyVerifies(signature: Uint8Array, message: Uint8Array, keys: readonly Uint8Array[]): Promise<boolean> {
  for (const key of keys) {
    try {
      if (await ed.verifyAsync(signature, message, key)) return true;
    } catch {
      // try next key
    }
  }
  return false;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
