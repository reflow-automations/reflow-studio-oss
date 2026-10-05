import { describe, expect, it } from "vitest";
import { bytesToBase64, decryptSecret, encryptSecret, keyHint, parseMasterKey } from "@/lib/settings/crypto";

const MASTER = crypto.getRandomValues(new Uint8Array(32));
const MASTER_B64 = bytesToBase64(MASTER);

describe("provider key encryption", () => {
  it("round-trips a secret under its AAD", async () => {
    const encrypted = await encryptSecret("fal-key-123456", "ws-1:fal", MASTER);
    expect(encrypted.ciphertext).not.toContain("fal-key");
    expect(atob(encrypted.iv)).toHaveLength(12);
    expect(await decryptSecret(encrypted, "ws-1:fal", MASTER)).toBe("fal-key-123456");
  });

  it("refuses to decrypt under another workspace/provider or another master key", async () => {
    const encrypted = await encryptSecret("kie-key-abcdef", "ws-1:kie", MASTER);
    await expect(decryptSecret(encrypted, "ws-2:kie", MASTER)).rejects.toThrow();
    await expect(decryptSecret(encrypted, "ws-1:fal", MASTER)).rejects.toThrow();
    await expect(decryptSecret(encrypted, "ws-1:kie", crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow();
  });

  it("uses a fresh IV per encryption", async () => {
    const a = await encryptSecret("same", "aad", MASTER);
    const b = await encryptSecret("same", "aad", MASTER);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("validates the master key", () => {
    expect(parseMasterKey(MASTER_B64)).toEqual(MASTER);
    expect(() => parseMasterKey(undefined)).toThrow(/KEY_ENCRYPTION_SECRET is not set/);
    expect(() => parseMasterKey(bytesToBase64(new Uint8Array(16)))).toThrow(/32 bytes/);
  });

  it("hints only the tail of a key", () => {
    expect(keyHint("short")).toBe("****");
    expect(keyHint("  fal-1234567890abcd  ")).toBe("…abcd");
  });
});
