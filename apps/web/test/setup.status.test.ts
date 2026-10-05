import { describe, expect, it } from "vitest";
import { deriveSecret, sha256HexSync } from "@/lib/secrets";
import type { ProviderKeyView } from "@/lib/settings/provider-keys";
import { REQUIRED_SCHEMA_VERSION } from "@/lib/setup/schema";
import { getSetupStatus, isMissingFunctionError, type SetupItem, type SetupStatus } from "@/lib/setup/status";
import { createFakeSupabase, type FakeSupabase } from "./_fake-supabase";

const SECRET = "a-very-long-random-deploy-secret-0123456789";
const ENV = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-abcdefgh",
  REFLOW_SECRET: SECRET,
  OWNER_EMAILS: "owner@studio.dev",
  APP_BASE_URL: "https://studio.dev",
  MONTHLY_BUDGET_USD: "10",
};

const falView = (overrides: Partial<ProviderKeyView> = {}): ProviderKeyView => ({ provider: "fal", label: "fal.ai", help: "", help_url: "", source: "app", key_hint: "...abcd", status: "valid", last_tested_at: null, last_error: null, ...overrides });

function item(status: SetupStatus, id: SetupItem["id"]): SetupItem {
  const found = status.items.find((i) => i.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
}

function readyDatabase(): FakeSupabase {
  const supa = createFakeSupabase();
  supa.db.allowedEmails.add("owner@studio.dev");
  supa.db.createAuthUser({ email: "owner@studio.dev", emailConfirmed: true });
  supa.db.reconcileConfig = { ...supa.db.reconcileConfig, app_base_url: true, reconcile_secret: true, vault_app_base_url: "https://studio.dev/", vault_reconcile_secret_sha256: sha256HexSync(deriveSecret(SECRET, "reconcile")) };
  return supa;
}

describe("getSetupStatus", () => {
  it("reports a fully configured deployment as ok, without leaking values", async () => {
    const supa = readyDatabase();
    const status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(status.items.filter((i) => i.status !== "ok")).toEqual([]);
    expect(status).toMatchObject({ ok: true, schemaVersion: REQUIRED_SCHEMA_VERSION, requiredSchemaVersion: REQUIRED_SCHEMA_VERSION, ownerExists: true, demoMode: false });
    expect(status.items.map((i) => i.id)).toEqual(["supabase", "secrets", "owner_emails", "environment", "database", "owner_account", "allowlist", "providers", "storage", "reconciler", "budget"]);
    const text = JSON.stringify(status);
    for (const secret of [SECRET, ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, deriveSecret(SECRET, "reconcile")]) expect(text).not.toContain(secret);
    // The vault check compared hashes only.
    expect(supa.db.rpcLog.find((c) => c.fn === "studio_reconcile_config")?.args).toEqual({ p_expected_base_url: "https://studio.dev", p_expected_secret_sha256: sha256HexSync(deriveSecret(SECRET, "reconcile")) });
  });

  it("lists what is missing on a fresh deployment", async () => {
    const status = await getSetupStatus({ env: { NODE_ENV: "production" }, admin: null });
    expect(status.ok).toBe(false);
    expect(item(status, "supabase").status).toBe("missing");
    expect(item(status, "supabase").hint).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(item(status, "secrets").status).toBe("missing");
    expect(item(status, "owner_emails").status).toBe("missing");
    expect(item(status, "database").status).toBe("missing");
    expect(item(status, "owner_account").status).toBe("missing");
    expect(item(status, "providers").status).toBe("missing");
    expect(item(status, "budget").status).toBe("warn");
    expect(status).toMatchObject({ schemaVersion: null, ownerExists: false });
  });

  it("treats a missing studio_schema_version() as migrations not applied", async () => {
    const supa = readyDatabase();
    supa.db.schemaVersion = null;
    const status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "database")).toMatchObject({ status: "missing" });
    expect(item(status, "database").hint).toMatch(/Migrations are not applied/);
    expect(status.schemaVersion).toBeNull();
    expect(status.items.some((i) => i.id === "allowlist")).toBe(false);
    expect(item(status, "reconciler").status).toBe("warn");
  });

  it("flags an outdated schema and an unsynced allowlist", async () => {
    const supa = readyDatabase();
    supa.db.schemaVersion = REQUIRED_SCHEMA_VERSION - 1;
    let status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "database").status).toBe("missing");
    expect(item(status, "database").hint).toContain(`needs ${REQUIRED_SCHEMA_VERSION}`);
    supa.db.schemaVersion = REQUIRED_SCHEMA_VERSION;
    supa.db.allowedEmails.clear();
    // The existing owner account does not need to be on the list (a deployment migrated by hand).
    status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "allowlist").status).toBe("ok");
    // A second OWNER_EMAILS address without an account cannot sign up yet.
    status = await getSetupStatus({ env: { ...ENV, OWNER_EMAILS: "owner@studio.dev, second@studio.dev" }, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "allowlist").status).toBe("warn");
  });

  it("reports a missing owner account", async () => {
    const supa = createFakeSupabase();
    const status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [] });
    expect(status.ownerExists).toBe(false);
    expect(item(status, "owner_account").status).toBe("missing");
  });

  it("needs at least one usable provider unless demo mode is on", async () => {
    const supa = readyDatabase();
    let status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView({ source: "none", status: null })] });
    expect(item(status, "providers").status).toBe("missing");
    status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView({ status: "invalid" }), falView({ provider: "kie", label: "Kie.ai", source: "env", status: "untested" })] });
    expect(item(status, "providers")).toMatchObject({ status: "warn" });
    status = await getSetupStatus({ env: { ...ENV, ENABLE_MOCK_PROVIDER: "true" }, admin: supa.client, listProviders: async () => [] });
    expect(item(status, "providers").status).toBe("ok");
    expect(status.demoMode).toBe(true);
  });

  it("explains reconciler problems", async () => {
    const supa = readyDatabase();
    supa.db.reconcileConfig = { ...supa.db.reconcileConfig, vault_reconcile_secret_sha256: "0".repeat(64) };
    let status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "reconciler")).toMatchObject({ status: "warn" });
    expect(item(status, "reconciler").hint).toMatch(/reconcile_secret differs/);
    supa.db.reconcileConfig = { ...supa.db.reconcileConfig, app_base_url: false, reconcile_secret: false };
    status = await getSetupStatus({ env: ENV, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "reconciler").hint).toMatch(/vault secrets/);
  });

  it("reports partial R2 configuration and invalid optional variables by name", async () => {
    const supa = readyDatabase();
    const status = await getSetupStatus({ env: { ...ENV, R2_ACCOUNT_ID: "acc", R2_BUCKET: "bucket", R2_PUBLIC_URL: "not a url" }, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "storage")).toMatchObject({ status: "warn" });
    expect(item(status, "storage").hint).toMatch(/R2_ACCESS_KEY_ID/);
    expect(item(status, "environment")).toMatchObject({ status: "missing" });
    expect(item(status, "environment").hint).toMatch(/R2_PUBLIC_URL/);
  });

  it("accepts the Vercel integration variable names", async () => {
    const supa = readyDatabase();
    const integration = { ...ENV, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x1234567", SUPABASE_SECRET_KEY: "test-secret-x1234567890" };
    const status = await getSetupStatus({ env: integration, admin: supa.client, listProviders: async () => [falView()] });
    expect(item(status, "supabase").status).toBe("ok");
  });

  it("never throws when a dependency hangs", async () => {
    const supa = readyDatabase();
    const hanging = new Proxy(supa.client, {
      get(target, prop, receiver) {
        if (prop === "rpc") return () => new Promise(() => {});
        return Reflect.get(target, prop, receiver);
      },
    });
    const status = await getSetupStatus({ env: ENV, admin: hanging, listProviders: async () => [falView()], timeoutMs: 20 });
    expect(item(status, "database")).toMatchObject({ status: "missing" });
    expect(item(status, "database").hint).toMatch(/timed out/);
  });
});

describe("isMissingFunctionError", () => {
  it("recognises PostgREST and Postgres variants", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883" })).toBe(true);
    expect(isMissingFunctionError({ message: "Could not find the function public.x in the schema cache" })).toBe(true);
    expect(isMissingFunctionError({ code: "42501" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});
