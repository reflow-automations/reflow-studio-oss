import { sha256Hex, StudioError } from "@reflow/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_SCOPES, clearApiKeyCaches, hasScope, isApiScope, verifyApiKey } from "@/lib/auth/api-keys";
import { requireScope } from "@/lib/auth/principal";
import { createFakeSupabase, type FakeSupabase } from "./_fake-supabase";

describe("scopes", () => {
  it("knows the scopes API keys can hold", () => {
    expect(API_SCOPES).toEqual(["read", "generate", "admin"]);
    expect(isApiScope("generate")).toBe(true);
    expect(isApiScope("write")).toBe(false);
  });

  it("grants a scope when listed or through admin", () => {
    expect(hasScope(["read"], "read")).toBe(true);
    expect(hasScope(["read"], "generate")).toBe(false);
    expect(hasScope(["admin"], "generate")).toBe(true);
    expect(hasScope(undefined, "read")).toBe(false);
  });

  it("requireScope throws a 403 StudioError for principals and bare scope lists", () => {
    expect(() => requireScope({ scopes: ["read", "generate"] }, "generate")).not.toThrow();
    expect(() => requireScope(["admin"], "generate")).not.toThrow();
    for (const subject of [{ scopes: ["read"] }, ["read"], null, undefined, { scopes: null }]) {
      try {
        requireScope(subject as never, "generate");
        throw new Error("expected requireScope to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(StudioError);
        expect((error as StudioError).code).toBe("unauthorized");
        expect((error as StudioError).status).toBe(403);
        expect((error as StudioError).message).toBe("missing scope generate");
      }
    }
  });
});

describe("verifyApiKey", () => {
  const SECRET = "rfl_test.secret.value.0123456789";
  const saved = { OWNER_EMAILS: process.env.OWNER_EMAILS, NODE_ENV: process.env.NODE_ENV };
  let supa: FakeSupabase;
  let now: Date;
  let userId: string;

  beforeEach(async () => {
    clearApiKeyCaches();
    process.env.OWNER_EMAILS = "owner@studio.dev";
    (process.env as Record<string, string>).NODE_ENV = "production";
    now = new Date("2026-10-05T10:00:00Z");
    supa = createFakeSupabase({ now: () => now });
    supa.db.allowedEmails.add("owner@studio.dev");
    userId = supa.db.createAuthUser({ email: "owner@studio.dev", emailConfirmed: true }).user!.id;
    const ws = supa.db.rows("workspaces")[0]!;
    supa.db.seed("api_keys", { id: "key-1", workspace_id: ws.id, user_id: userId, name: "agent", prefix: SECRET.slice(0, 12), key_hash: await sha256Hex(SECRET), scopes: ["read"] });
  });

  afterEach(() => {
    process.env.OWNER_EMAILS = saved.OWNER_EMAILS;
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
  });

  const verify = (secret: string | null = SECRET) => verifyApiKey(secret, { admin: supa.client, now: () => now });

  it("resolves an owner's key and throttles last_used_at writes", async () => {
    expect(await verify()).toMatchObject({ apiKeyId: "key-1", userId, scopes: ["read"] });
    expect(supa.db.find("api_keys", "key-1")?.last_used_at).toBe("2026-10-05T10:00:00.000Z");
    const writes = () => supa.db.log.filter((op) => op.table === "api_keys" && op.op === "update").length;
    expect(writes()).toBe(1);
    now = new Date("2026-10-05T10:04:00Z");
    await verify();
    expect(writes()).toBe(1);
    now = new Date("2026-10-05T10:06:00Z");
    await verify();
    expect(writes()).toBe(2);
  });

  it("checks OWNER_EMAILS against the auth e-mail, not the editable profile", async () => {
    supa.db.patch("profiles", userId, { email: "someone-else@studio.dev" });
    expect(await verify()).not.toBeNull();
    // An account that was removed from the list stays out even if its profile claims an owner address.
    process.env.OWNER_EMAILS = "new-owner@studio.dev";
    clearApiKeyCaches();
    supa.db.patch("profiles", userId, { email: "new-owner@studio.dev" });
    expect(await verify()).toBeNull();
  });

  it("rejects unknown, revoked and expired keys", async () => {
    expect(await verify(null)).toBeNull();
    expect(await verify("not-a-key")).toBeNull();
    expect(await verify("rfl_unknown")).toBeNull();
    supa.db.patch("api_keys", "key-1", { expires_at: "2026-10-05T09:00:00.000Z" });
    expect(await verify()).toBeNull();
    supa.db.patch("api_keys", "key-1", { expires_at: null, revoked_at: "2026-10-05T09:00:00.000Z" });
    expect(await verify()).toBeNull();
  });

  it("rejects keys whose auth user no longer exists", async () => {
    supa.db.users.splice(0, supa.db.users.length);
    expect(await verify()).toBeNull();
  });
});
