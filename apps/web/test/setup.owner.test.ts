import { beforeEach, describe, expect, it } from "vitest";
import { createFirstOwner, ownerAccountExists, resetFirstOwnerThrottle } from "@/lib/setup/owner";
import { createFakeSupabase, type FakeSupabase } from "./_fake-supabase";

const SECRET = "a-very-long-random-deploy-secret-0123456789";
const ENV = { NODE_ENV: "production", REFLOW_SECRET: SECRET, OWNER_EMAILS: "Owner@Studio.dev, second@studio.dev" };
const INPUT = { email: "owner@studio.dev", password: "correct horse battery", setupSecret: SECRET, clientKey: "203.0.113.7" };

let supa: FakeSupabase;
let clock: number;
const deps = (env: Record<string, string | undefined> = ENV) => ({ env, admin: supa.client, now: () => clock });

beforeEach(() => {
  resetFirstOwnerThrottle();
  supa = createFakeSupabase();
  clock = Date.parse("2026-10-05T10:00:00Z");
});

describe("createFirstOwner", () => {
  it("syncs the allowlist and creates a confirmed owner in the default workspace", async () => {
    const result = await createFirstOwner({ ...INPUT, email: " OWNER@studio.dev " }, deps());
    expect(result).toMatchObject({ ok: true, email: "owner@studio.dev" });
    expect([...supa.db.allowedEmails].sort()).toEqual(["owner@studio.dev", "second@studio.dev"]);
    const user = supa.db.users[0]!;
    expect(user.email).toBe("owner@studio.dev");
    expect(user.email_confirmed_at).not.toBeNull();
    const membership = supa.db.rows("workspace_members").find((m) => m.user_id === user.id);
    expect(membership?.role).toBe("owner");
    expect(await ownerAccountExists(deps())).toBe(true);
  });

  it("works only while no owner account exists", async () => {
    expect((await createFirstOwner(INPUT, deps())).ok).toBe(true);
    const second = await createFirstOwner({ ...INPUT, email: "second@studio.dev" }, deps());
    expect(second).toMatchObject({ ok: false, code: "owner_exists", status: 409 });
    expect(supa.db.users).toHaveLength(1);
  });

  it("requires the deploy secret and throttles repeated guesses", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await createFirstOwner({ ...INPUT, setupSecret: `wrong-${i}` }, deps());
      expect(result).toMatchObject({ ok: false, code: "invalid_secret", status: 401 });
    }
    const blocked = await createFirstOwner(INPUT, deps());
    expect(blocked).toMatchObject({ ok: false, code: "rate_limited", status: 429 });
    expect(blocked.ok === false && blocked.retryAfterSeconds).toBe(15 * 60);
    expect(supa.db.users).toHaveLength(0);
    // Another client is not blocked, and the window expires.
    expect((await createFirstOwner({ ...INPUT, clientKey: "198.51.100.1", setupSecret: "nope" }, deps())).ok === false).toBe(true);
    clock += 15 * 60 * 1000 + 1;
    expect(await createFirstOwner(INPUT, deps())).toMatchObject({ ok: true });
  });

  it("accepts WEBHOOK_SECRET as the setup secret on legacy deployments", async () => {
    const legacy = { NODE_ENV: "production", WEBHOOK_SECRET: "legacy-webhook-secret-0123456789", OWNER_EMAILS: "owner@studio.dev" };
    expect(await createFirstOwner({ ...INPUT, setupSecret: SECRET }, deps(legacy))).toMatchObject({ code: "invalid_secret" });
    expect(await createFirstOwner({ ...INPUT, setupSecret: "legacy-webhook-secret-0123456789" }, deps(legacy))).toMatchObject({ ok: true });
  });

  it("only accepts OWNER_EMAILS addresses, and needs the list in production", async () => {
    expect(await createFirstOwner({ ...INPUT, email: "intruder@evil.dev" }, deps())).toMatchObject({ ok: false, code: "not_allowed", status: 403 });
    expect(await createFirstOwner(INPUT, deps({ NODE_ENV: "production", REFLOW_SECRET: SECRET }))).toMatchObject({ ok: false, code: "not_configured" });
    // Development without OWNER_EMAILS: the typed address becomes the allowlist.
    expect(await createFirstOwner({ ...INPUT, email: "dev@studio.dev" }, deps({ NODE_ENV: "development", REFLOW_SECRET: SECRET }))).toMatchObject({ ok: true });
    expect([...supa.db.allowedEmails]).toEqual(["dev@studio.dev"]);
  });

  it("validates input before doing anything", async () => {
    expect(await createFirstOwner({ ...INPUT, email: "not-an-email" }, deps())).toMatchObject({ code: "invalid_input", status: 400 });
    expect(await createFirstOwner({ ...INPUT, password: "short" }, deps())).toMatchObject({ code: "invalid_input" });
    expect(await createFirstOwner({ ...INPUT, password: "x".repeat(73) }, deps())).toMatchObject({ code: "invalid_input" });
    expect(await createFirstOwner({ ...INPUT, setupSecret: " " }, deps())).toMatchObject({ code: "invalid_input" });
    expect(supa.db.rpcLog).toEqual([]);
  });

  it("explains missing configuration", async () => {
    expect(await createFirstOwner(INPUT, deps({ NODE_ENV: "production", OWNER_EMAILS: "owner@studio.dev" }))).toMatchObject({ code: "not_configured", status: 503 });
    expect(await createFirstOwner(INPUT, { env: ENV, admin: null, now: () => clock })).toMatchObject({ code: "not_configured" });
    supa.db.missingFunctions.add("sync_allowed_emails");
    const result = await createFirstOwner(INPUT, deps());
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(result.ok === false && result.message).toMatch(/migrations/);
  });

  it("never reveals the secret in its messages", async () => {
    const results = [await createFirstOwner({ ...INPUT, setupSecret: "wrong" }, deps()), await createFirstOwner(INPUT, deps({ NODE_ENV: "production", REFLOW_SECRET: SECRET }))];
    for (const result of results) expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
