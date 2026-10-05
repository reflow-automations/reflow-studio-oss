import { hkdfSync } from "node:crypto";

/**
 * AES-256-GCM secret encryption via Web Crypto (server side).
 *
 * The master key comes from `KEY_ENCRYPTION_SECRET` (or is derived from
 * `REFLOW_SECRET`, see lib/secrets.ts). The AAD binds a ciphertext to
 * `<workspace>:<provider>` so a stored key cannot be moved to another
 * workspace or provider.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface EncryptedSecret {
  /** base64 */
  ciphertext: string;
  /** base64, 12 bytes */
  iv: string;
}

/** Shortest passphrase accepted when the secret is not a 32-byte base64 key. */
export const MIN_PASSPHRASE_LENGTH = 32;

/**
 * 32-byte AES key from the configured secret. A value that is exactly 32 bytes
 * of base64 (what `openssl rand -base64 32` prints) is used as-is, so existing
 * ciphertexts stay readable. Any other string of at least 32 characters (hex,
 * a passphrase, a password-manager value) is run through HKDF-SHA256 with the
 * same label lib/secrets.ts uses, so `parseMasterKey(REFLOW_SECRET)` equals the
 * key derived from REFLOW_SECRET.
 */
export function parseMasterKey(secret: string | undefined): Uint8Array {
  const value = secret?.trim();
  if (!value) throw new Error("KEY_ENCRYPTION_SECRET is not set (set REFLOW_SECRET, or 32 random bytes in base64: `openssl rand -base64 32`)");
  const raw = decodeBase64Key(value);
  if (raw) return raw;
  if (value.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`KEY_ENCRYPTION_SECRET is too short: use 32 bytes of base64 (\`openssl rand -base64 32\`) or any secret of at least ${MIN_PASSPHRASE_LENGTH} characters (got ${value.length})`);
  }
  return new Uint8Array(hkdfSync("sha256", value, "", "reflow:key-encryption", 32));
}

/** The 32 key bytes when `value` is standard base64 of exactly 32 bytes (padding optional), otherwise null. */
function decodeBase64Key(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) return null;
  try {
    const raw = base64ToBytes(value.endsWith("=") ? value : `${value}=`);
    return raw.length === 32 ? raw : null;
  } catch {
    return null;
  }
}

async function importKey(master: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", master as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string, aad: string, master: Uint8Array): Promise<EncryptedSecret> {
  const key = await importKey(master);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext));
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

export async function decryptSecret(secret: EncryptedSecret, aad: string, master: Uint8Array): Promise<string> {
  const key = await importKey(master);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(secret.iv) as BufferSource, additionalData: enc.encode(aad) }, key, base64ToBytes(secret.ciphertext) as BufferSource);
  return dec.decode(plain);
}

/** Last four characters, enough to recognise a key without revealing it. */
export function keyHint(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 8 ? "****" : `…${trimmed.slice(-4)}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
