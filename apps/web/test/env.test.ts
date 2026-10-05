import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { appBaseUrl, env, parseEnv, resetEnvCache, withoutEmpty, withSupabaseFallbacks } from "@/lib/env";
import { deriveSecret } from "@/lib/secrets";

const SECRET = "a-very-long-random-deploy-secret-0123456789";
const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-abcdefgh",
  REFLOW_SECRET: SECRET,
};

function ok(source: Record<string, string | undefined>) {
  const parsed = parseEnv(source);
  if (!parsed.ok) throw new Error(`expected a valid env, got ${JSON.stringify(parsed.issues)}`);
  return parsed.env;
}

function issues(source: Record<string, string | undefined>) {
  const parsed = parseEnv(source);
  if (parsed.ok) throw new Error("expected env issues");
  return parsed.issues;
}

describe("parseEnv", () => {
  it("treats empty values as unset (copied .env.example lines like R2_PUBLIC_URL=)", () => {
    const e = ok({ ...BASE, R2_PUBLIC_URL: "", APP_BASE_URL: "  ", ENABLE_MOCK_PROVIDER: "", MONTHLY_BUDGET_USD: "" });
    expect(e.R2_PUBLIC_URL).toBeUndefined();
    expect(e.APP_BASE_URL).toBeUndefined();
    expect(e.ENABLE_MOCK_PROVIDER).toBe(false);
    expect(e.MONTHLY_BUDGET_USD).toBeUndefined();
    expect(withoutEmpty({ A: "", B: " ", C: "x", D: undefined })).toEqual({ C: "x" });
  });

  it("derives the three secrets from REFLOW_SECRET", () => {
    const e = ok(BASE);
    expect(e.WEBHOOK_SECRET).toBe(deriveSecret(SECRET, "webhook"));
    expect(e.RECONCILE_SECRET).toBe(deriveSecret(SECRET, "reconcile"));
    expect(e.KEY_ENCRYPTION_SECRET).toBe(deriveSecret(SECRET, "key-encryption"));
    expect(e.secretSources.webhook).toBe("derived");
  });

  it("keeps legacy deployments working with explicit secrets and no REFLOW_SECRET", () => {
    const legacyKey = Buffer.alloc(32, 7).toString("base64");
    const e = ok({ ...BASE, REFLOW_SECRET: undefined, WEBHOOK_SECRET: "legacy-webhook-secret-0123456789abcdef", KEY_ENCRYPTION_SECRET: legacyKey });
    expect(e.WEBHOOK_SECRET).toBe("legacy-webhook-secret-0123456789abcdef");
    expect(e.RECONCILE_SECRET).toBe("legacy-webhook-secret-0123456789abcdef");
    expect(e.KEY_ENCRYPTION_SECRET).toBe(legacyKey);
  });

  it("requires REFLOW_SECRET (or a legacy WEBHOOK_SECRET)", () => {
    expect(issues({ ...BASE, REFLOW_SECRET: undefined }).map((i) => i.variable)).toContain("REFLOW_SECRET");
    expect(issues({ ...BASE, REFLOW_SECRET: "too-short" }).map((i) => i.variable)).toContain("REFLOW_SECRET");
  });

  it("rejects .env.example placeholders by name, without echoing values", () => {
    const found = issues({ ...BASE, REFLOW_SECRET: undefined, WEBHOOK_SECRET: "<openssl rand -hex 32>", NEXT_PUBLIC_SUPABASE_ANON_KEY: "<anon or publishable key>" });
    expect(found.map((i) => i.variable).sort()).toEqual(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "WEBHOOK_SECRET"]);
    expect(JSON.stringify(found)).not.toContain("openssl rand");
  });

  it("rejects example.com URLs and addresses in production only", () => {
    const placeholders = { ...BASE, APP_BASE_URL: "https://studio.example.com", OWNER_EMAILS: "you@example.com" };
    expect(issues({ ...placeholders, NODE_ENV: "production" }).map((i) => i.variable).sort()).toEqual(["APP_BASE_URL", "OWNER_EMAILS"]);
    expect(ok({ ...placeholders, NODE_ENV: "development" }).OWNER_EMAILS).toBe("you@example.com");
  });

  it("accepts the Vercel Supabase integration names, with explicit names winning", () => {
    const integration = {
      SUPABASE_URL: "https://integration.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_integration",
      SUPABASE_SECRET_KEY: "test-integration-secret-key",
      REFLOW_SECRET: SECRET,
    };
    const e = ok(integration);
    expect(e.NEXT_PUBLIC_SUPABASE_URL).toBe("https://integration.supabase.co");
    expect(e.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_integration");
    expect(e.SUPABASE_SERVICE_ROLE_KEY).toBe("test-integration-secret-key");
    expect(ok({ ...integration, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_server_only", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }).NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("sb_publishable_server_only");
    const both = withSupabaseFallbacks({ ...integration, NEXT_PUBLIC_SUPABASE_URL: "https://explicit.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "explicit-anon-key", SUPABASE_SERVICE_ROLE_KEY: "explicit-service" });
    expect(both).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: "https://explicit.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "explicit-anon-key", SUPABASE_SERVICE_ROLE_KEY: "explicit-service" });
  });

  it("accepts apps/web/.env.example once the required values are filled in", () => {
    const text = readFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");
    const fromFile: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) fromFile[match[1]!] = match[2]!;
    }
    expect(Object.keys(fromFile)).toEqual(expect.arrayContaining(["NEXT_PUBLIC_SUPABASE_URL", "REFLOW_SECRET", "OWNER_EMAILS"]));
    const e = ok({ ...fromFile, ...BASE, OWNER_EMAILS: "owner@studio.dev", NODE_ENV: "production" });
    expect(e.MONTHLY_BUDGET_USD).toBe(10);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("env() and appBaseUrl()", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it("throws a message that names variables but never values", () => {
    process.env = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abcdefghijklmnop", SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-abcdefgh", WEBHOOK_SECRET: "<openssl rand -hex 32>" };
    resetEnvCache();
    expect(() => env()).toThrow(/WEBHOOK_SECRET/);
    expect(() => env()).not.toThrow(/openssl rand -hex/);
  });

  it("prefers APP_BASE_URL, then the Vercel production URL", () => {
    expect(appBaseUrl({ APP_BASE_URL: "https://studio.test/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe("https://studio.test");
    expect(appBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app", VERCEL_URL: "y.vercel.app" })).toBe("https://x.vercel.app");
    expect(appBaseUrl({ APP_BASE_URL: "" })).toBe("http://localhost:3000");
  });
});
