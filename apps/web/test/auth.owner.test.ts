import { describe, expect, it } from "vitest";
import { checkOwner, isOwnerEmail, ownerEmails, signupEnabled } from "@/lib/auth/owner";

describe("owner allowlist", () => {
  it("parses OWNER_EMAILS case-insensitively", () => {
    expect(ownerEmails({ OWNER_EMAILS: " Owner@Example.com, second@example.com ,, " })).toEqual(["owner@example.com", "second@example.com"]);
    expect(ownerEmails({})).toEqual([]);
  });

  it("allows only listed accounts when the list is set", () => {
    const env = { OWNER_EMAILS: "owner@example.com", NODE_ENV: "production" };
    expect(checkOwner("OWNER@example.com", env)).toEqual({ allowed: true });
    expect(checkOwner("intruder@example.com", env)).toEqual({ allowed: false, reason: "not_allowed" });
    expect(checkOwner(null, env)).toEqual({ allowed: false, reason: "not_allowed" });
    expect(isOwnerEmail("owner@example.com", env)).toBe(true);
  });

  it("fails closed in production and stays open in development when the list is empty", () => {
    expect(checkOwner("anyone@example.com", { NODE_ENV: "production" })).toEqual({ allowed: false, reason: "owner_list_missing" });
    expect(checkOwner("anyone@example.com", { NODE_ENV: "development" })).toEqual({ allowed: true });
    expect(checkOwner("anyone@example.com", { NODE_ENV: "test" })).toEqual({ allowed: true });
  });

  it("offers signup only without an allowlist or when explicitly enabled", () => {
    expect(signupEnabled({})).toBe(true);
    expect(signupEnabled({ OWNER_EMAILS: "owner@example.com" })).toBe(false);
    expect(signupEnabled({ OWNER_EMAILS: "owner@example.com", ALLOW_SIGNUP: "true" })).toBe(true);
  });
});
