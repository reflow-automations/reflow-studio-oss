import { describe, expect, it } from "vitest";
import { deriveSecret as deriveSecretMjs, resolveReconcileSecret } from "../scripts/migrate-lib.mjs";
import { deriveSecret, deriveSecretBytes, looksLikePlaceholder, resolveSecrets, safeEqual, sha256HexSync } from "@/lib/secrets";
import { base64ToBytes, bytesToBase64, decryptSecret, encryptSecret, parseMasterKey } from "@/lib/settings/crypto";

const MASTER = "a-very-long-random-deploy-secret-0123456789";

describe("deriveSecret", () => {
  it("is deterministic, 32 bytes, and different per purpose", () => {
    expect(deriveSecretBytes(MASTER, "webhook")).toHaveLength(32);
    expect(deriveSecret(MASTER, "webhook")).toBe(deriveSecret(MASTER, "webhook"));
    const values = new Set([deriveSecret(MASTER, "webhook"), deriveSecret(MASTER, "reconcile"), deriveSecret(MASTER, "key-encryption")]);
    expect(values.size).toBe(3);
    expect(deriveSecret(MASTER, "webhook")).not.toBe(deriveSecret(`${MASTER}x`, "webhook"));
  });

  it("uses base64url for header secrets and base64 for the encryption key", () => {
    expect(deriveSecret(MASTER, "reconcile")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deriveSecret(MASTER, "key-encryption")).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("matches the plain-JS derivation the build script writes into the vault", () => {
    expect(deriveSecretMjs(MASTER, "reconcile")).toBe(deriveSecret(MASTER, "reconcile"));
    expect(deriveSecretMjs(MASTER, "webhook")).toBe(deriveSecret(MASTER, "webhook"));
    for (const env of [{ REFLOW_SECRET: MASTER }, { REFLOW_SECRET: MASTER, RECONCILE_SECRET: "explicit-reconcile-secret-1234" }, { WEBHOOK_SECRET: "legacy-webhook-secret-123456789" }]) {
      expect(resolveReconcileSecret(env)).toBe(resolveSecrets(env).reconcileSecret);
    }
  });
});

describe("resolveSecrets", () => {
  it("derives everything from REFLOW_SECRET", () => {
    const s = resolveSecrets({ REFLOW_SECRET: MASTER });
    expect(s.webhookSecret).toBe(deriveSecret(MASTER, "webhook"));
    expect(s.reconcileSecret).toBe(deriveSecret(MASTER, "reconcile"));
    expect(s.keyEncryptionSecret).toBe(deriveSecret(MASTER, "key-encryption"));
    expect(s.setupSecret).toBe(MASTER);
    expect(s.sources).toEqual({ webhook: "derived", reconcile: "derived", keyEncryption: "derived", setup: "explicit" });
  });

  it("lets explicit legacy secrets win so existing deployments keep their tokens and ciphertexts", () => {
    const s = resolveSecrets({ REFLOW_SECRET: MASTER, WEBHOOK_SECRET: "old-webhook", RECONCILE_SECRET: "old-reconcile", KEY_ENCRYPTION_SECRET: "old-key" });
    expect(s).toMatchObject({ webhookSecret: "old-webhook", reconcileSecret: "old-reconcile", keyEncryptionSecret: "old-key", setupSecret: MASTER });
  });

  it("falls back to WEBHOOK_SECRET for reconcile and setup on legacy deployments", () => {
    const s = resolveSecrets({ WEBHOOK_SECRET: "legacy-webhook" });
    expect(s).toMatchObject({ webhookSecret: "legacy-webhook", reconcileSecret: "legacy-webhook", keyEncryptionSecret: undefined, setupSecret: "legacy-webhook" });
    expect(s.sources).toEqual({ webhook: "explicit", reconcile: "legacy", keyEncryption: "missing", setup: "legacy" });
  });

  it("treats blank values as unset", () => {
    expect(resolveSecrets({ REFLOW_SECRET: "  ", WEBHOOK_SECRET: "" }).sources.webhook).toBe("missing");
  });
});

describe("parseMasterKey with derived and free-form secrets", () => {
  it("uses 32 bytes of base64 as-is (existing KEY_ENCRYPTION_SECRET values)", () => {
    const raw = new Uint8Array(32).map((_, i) => i);
    expect(parseMasterKey(bytesToBase64(raw))).toEqual(raw);
    expect(parseMasterKey(bytesToBase64(raw).replace(/=$/, ""))).toEqual(raw);
  });

  it("HKDF-derives other formats of at least 32 characters, consistent with REFLOW_SECRET", () => {
    const fromPassphrase = parseMasterKey(MASTER);
    expect(fromPassphrase).toHaveLength(32);
    expect(fromPassphrase).toEqual(base64ToBytes(deriveSecret(MASTER, "key-encryption")));
    expect(parseMasterKey(deriveSecret(MASTER, "key-encryption"))).toEqual(fromPassphrase);
    const hex = "ab".repeat(32);
    expect(parseMasterKey(hex)).toHaveLength(32);
    expect(parseMasterKey(hex)).not.toEqual(parseMasterKey("cd".repeat(32)));
  });

  it("rejects short secrets", () => {
    expect(() => parseMasterKey("short-secret")).toThrow(/at least 32 characters/);
  });

  it("round-trips encryption with a derived key", async () => {
    const key = parseMasterKey(resolveSecrets({ REFLOW_SECRET: MASTER }).keyEncryptionSecret);
    const sealed = await encryptSecret("fal-key-123", "ws:fal", key);
    expect(await decryptSecret(sealed, "ws:fal", key)).toBe("fal-key-123");
  });
});

describe("helpers", () => {
  it("spots .env.example placeholders but not random values", () => {
    for (const v of ["<openssl rand -hex 32>", "<32 random bytes, base64>", "changeme", "replace-me", "xxxxxxxx"]) expect(looksLikePlaceholder(v)).toBe(true);
    for (const v of [MASTER, deriveSecret(MASTER, "webhook"), deriveSecret(MASTER, "key-encryption")]) expect(looksLikePlaceholder(v)).toBe(false);
  });

  it("compares in constant time and exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(sha256HexSync("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
