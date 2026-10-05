import "server-only";
import { createHash, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * One deploy secret, many purposes.
 *
 * A fresh install sets a single `REFLOW_SECRET` (any random string of at least
 * 32 characters). The webhook HMAC key, the reconcile bearer secret and the
 * provider-key encryption key are derived from it with HKDF-SHA256, one `info`
 * label per purpose, so leaking one derived value does not reveal the others.
 *
 * Explicit `WEBHOOK_SECRET`, `RECONCILE_SECRET` and `KEY_ENCRYPTION_SECRET`
 * always win, so deployments configured before `REFLOW_SECRET` existed keep
 * their webhook tokens and can still decrypt the provider keys they stored.
 *
 * `apps/web/scripts/migrate-lib.mjs` repeats the reconcile derivation in plain
 * JavaScript (it writes the vault copy at build time); a test keeps both equal.
 */

export type SecretPurpose = "webhook" | "reconcile" | "key-encryption";

export const REFLOW_SECRET_MIN_LENGTH = 32;
/** Legacy explicit secrets were validated with this minimum; kept so existing deployments stay valid. */
export const LEGACY_SECRET_MIN_LENGTH = 16;

/** 32 bytes of HKDF-SHA256(master, salt = "", info = "reflow:<purpose>"). */
export function deriveSecretBytes(master: string, purpose: SecretPurpose): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", master, "", `reflow:${purpose}`, 32));
}

/**
 * Derived secret as text: base64 for the encryption key (so `parseMasterKey`
 * uses it as-is), base64url for the others (safe in headers and URLs).
 */
export function deriveSecret(master: string, purpose: SecretPurpose): string {
  const bytes = Buffer.from(deriveSecretBytes(master, purpose));
  return purpose === "key-encryption" ? bytes.toString("base64") : bytes.toString("base64url");
}

/**
 * True for values copied from `.env.example` or docs instead of generated:
 * angle-bracket placeholders, the generator command itself, "changeme" style
 * fillers. Real random secrets never match.
 */
export function looksLikePlaceholder(value: string): boolean {
  return /[<>]|\bopenssl\b|\brand\s+-(?:hex|base64)\b|randomBytes|change[-_ ]?me|replace[-_ ]?me|your[-_ ]secret|^x{6,}$/i.test(value.trim());
}

export type SecretSource = "explicit" | "derived" | "legacy" | "missing";

export interface ResolvedSecrets {
  /** HMAC key for webhook URL tokens (`?t=`). */
  webhookSecret: string | undefined;
  /** Bearer secret pg_cron sends to /api/internal/reconcile (also stored in the Supabase vault). */
  reconcileSecret: string | undefined;
  /** Master secret for provider keys stored in the app; `parseMasterKey` turns it into 32 bytes. */
  keyEncryptionSecret: string | undefined;
  /** The secret a person types on /setup to create the first owner: REFLOW_SECRET, or WEBHOOK_SECRET on legacy deployments. */
  setupSecret: string | undefined;
  sources: { webhook: SecretSource; reconcile: SecretSource; keyEncryption: SecretSource; setup: SecretSource };
}

type SecretEnv = Partial<Record<"REFLOW_SECRET" | "WEBHOOK_SECRET" | "RECONCILE_SECRET" | "KEY_ENCRYPTION_SECRET", string | undefined>> & Record<string, unknown>;

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the effective secrets. Pure: callers validate lengths and
 * placeholders (env.ts does) before trusting the result.
 *   webhook        = WEBHOOK_SECRET        || HKDF(REFLOW_SECRET, "webhook")
 *   reconcile      = RECONCILE_SECRET      || HKDF(REFLOW_SECRET, "reconcile") || WEBHOOK_SECRET
 *   key-encryption = KEY_ENCRYPTION_SECRET || HKDF(REFLOW_SECRET, "key-encryption")
 *   setup          = REFLOW_SECRET         || WEBHOOK_SECRET
 */
export function resolveSecrets(source: SecretEnv = process.env): ResolvedSecrets {
  const master = present(source.REFLOW_SECRET);
  const webhook = present(source.WEBHOOK_SECRET);
  const reconcile = present(source.RECONCILE_SECRET);
  const keyEncryption = present(source.KEY_ENCRYPTION_SECRET);

  const webhookSecret = webhook ?? (master ? deriveSecret(master, "webhook") : undefined);
  const reconcileSecret = reconcile ?? (master ? deriveSecret(master, "reconcile") : webhook);
  const keyEncryptionSecret = keyEncryption ?? (master ? deriveSecret(master, "key-encryption") : undefined);
  const setupSecret = master ?? webhook;

  return {
    webhookSecret,
    reconcileSecret,
    keyEncryptionSecret,
    setupSecret,
    sources: {
      webhook: webhook ? "explicit" : master ? "derived" : "missing",
      reconcile: reconcile ? "explicit" : master ? "derived" : webhook ? "legacy" : "missing",
      keyEncryption: keyEncryption ? "explicit" : master ? "derived" : "missing",
      setup: master ? "explicit" : webhook ? "legacy" : "missing",
    },
  };
}

/** Constant-time string comparison (hashing first equalises the lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Lower-case hex sha256, e.g. to compare a secret with its vault copy without sending it. */
export function sha256HexSync(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
