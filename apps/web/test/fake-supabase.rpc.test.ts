import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./_fake-supabase";
import { createHarness } from "./_harness";

/**
 * The fake's rpc() must mirror supabase/migrations/0007 so later service tests
 * can switch StudioService to month_to_date_spend / reserve_budget safely.
 */
describe("fake rpc: budget functions", () => {
  it("month_to_date_spend matches StudioService.monthToDateSpend on the same ledger", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const now = h.clock.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const before = new Date(monthStart.getTime() - 1000).toISOString();
    const during = new Date(monthStart.getTime() + 1000).toISOString();
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "settlement", amount_usd: 5, created_at: before });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "settlement", amount_usd: 0.1, created_at: during });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "reservation", amount_usd: 0.25, created_at: during });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "release", amount_usd: -0.3, created_at: before });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "topup", amount_usd: -20, created_at: during });
    h.db.seed("ledger_entries", { workspace_id: h.otherWorkspace.id, entry_type: "settlement", amount_usd: 99, created_at: during });

    const expected = await h.service.monthToDateSpend(ws);
    const { data, error } = await h.supa.client.rpc("month_to_date_spend", { p_workspace_id: ws }).single();
    expect(error).toBeNull();
    expect(data).toEqual(expected);
    expect(data).toEqual({ settled_usd: 0.1, reserved_usd: 0.25 });
  });

  it("reserve_budget checks the cap and writes the reservation in one call", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const gen = h.db.seed("generations", { workspace_id: ws, model_id: "m", output_type: "image", request: {} });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "settlement", amount_usd: 9.5, created_at: h.clock.now().toISOString() });

    const ok = await h.supa.client.rpc("reserve_budget", { p_workspace_id: ws, p_generation_id: gen.id, p_amount_usd: 0.4, p_cap_usd: 10, p_provider: "mock" }).single();
    expect(ok.data).toMatchObject({ ok: true, settled_usd: 9.5, reserved_usd: 0 });
    const entry = h.db.rows("ledger_entries").find((e) => e.id === ok.data?.ledger_entry_id);
    expect(entry).toMatchObject({ entry_type: "reservation", amount_usd: 0.4, provider: "mock", generation_id: gen.id, note: "highest known candidate estimate including fallback" });

    const refused = await h.supa.client.rpc("reserve_budget", { p_workspace_id: ws, p_generation_id: gen.id, p_amount_usd: 0.2, p_cap_usd: 10 }).single();
    expect(refused.data).toEqual({ ok: false, settled_usd: 9.5, reserved_usd: 0.4, ledger_entry_id: null });

    const unlimited = await h.supa.client.rpc("reserve_budget", { p_workspace_id: ws, p_generation_id: gen.id, p_amount_usd: 50, p_cap_usd: 0 }).single();
    expect(unlimited.data?.ok).toBe(true);

    const foreign = await h.supa.client.rpc("reserve_budget", { p_workspace_id: h.otherWorkspace.id, p_generation_id: gen.id, p_amount_usd: 1 });
    expect(foreign.error?.code).toBe("22023");
  });

  it("answers PGRST202 for functions marked missing and throws for unmodelled ones", async () => {
    const supa = createFakeSupabase();
    supa.db.missingFunctions.add("studio_schema_version");
    const { error } = await supa.client.rpc("studio_schema_version");
    expect(error?.code).toBe("PGRST202");
    await expect(Promise.resolve(supa.client.rpc("nope" as never))).rejects.toThrow(/not modelled/);
  });
});

describe("fake auth.admin and allowlist", () => {
  it("refuses accounts outside private.allowed_emails and runs handle_new_user for allowed ones", async () => {
    const supa = createFakeSupabase();
    const refused = await supa.client.auth.admin.createUser({ email: "owner@studio.dev", password: "long-password", email_confirm: true });
    expect(refused.error?.message).toMatch(/Database error/);
    expect((await supa.client.rpc("sync_allowed_emails", { p_emails: [" Owner@Studio.dev ", "bad", "owner@studio.dev"] })).data).toBe(1);
    const created = await supa.client.auth.admin.createUser({ email: "owner@studio.dev", password: "long-password", email_confirm: true });
    expect(created.data.user?.email).toBe("owner@studio.dev");
    const [workspace] = supa.db.rows("workspaces");
    expect(workspace?.slug).toBe("default");
    expect(supa.db.rows("workspace_members")).toMatchObject([{ workspace_id: workspace?.id, user_id: created.data.user?.id, role: "owner" }]);
    expect((await supa.client.auth.admin.getUserById(created.data.user!.id)).data.user?.email).toBe("owner@studio.dev");
    expect((await supa.client.auth.admin.listUsers({ page: 1, perPage: 50 })).data.users).toHaveLength(1);
    const status = await supa.client.rpc("studio_allowlist_status", { p_emails: ["owner@studio.dev", "Other@Studio.dev"] });
    expect(status.data).toEqual({ allowed_count: 1, missing: ["other@studio.dev"] });
  });
});

describe("fake shares table", () => {
  it("enforces one active share per generation and output, and filters with is()", async () => {
    const h = createHarness();
    const gen = h.db.seed("generations", { workspace_id: h.workspace.id, model_id: "m", output_type: "image", request: {} });
    const insert = (token: string, extra: Record<string, unknown> = {}) => h.supa.client.from("shares").insert({ workspace_id: h.workspace.id, generation_id: gen.id, token, ...extra }).select("*").single();
    const first = await insert("abcdefghijklmnopqrstuv");
    expect(first.data).toMatchObject({ output_index: null, show_prompt: true, show_cost: false, in_gallery: false, revoked_at: null });
    expect((await insert("bbcdefghijklmnopqrstuv")).error?.code).toBe("23505");
    expect((await insert("cbcdefghijklmnopqrstuv", { output_index: 0 })).error).toBeNull();
    await h.supa.client.from("shares").update({ revoked_at: h.clock.now().toISOString() }).eq("token", "abcdefghijklmnopqrstuv");
    expect((await insert("dbcdefghijklmnopqrstuv")).error).toBeNull();
    const active = await h.supa.client.from("shares").select("token").eq("generation_id", gen.id).is("revoked_at", null);
    expect((active.data ?? []).map((s) => s.token).sort()).toEqual(["cbcdefghijklmnopqrstuv", "dbcdefghijklmnopqrstuv"]);
    const joined = await h.supa.client.from("shares").select("token, generations!inner(model_id)").eq("token", "cbcdefghijklmnopqrstuv").maybeSingle();
    expect(joined.data).toEqual({ token: "cbcdefghijklmnopqrstuv", generations: { model_id: "m" } });
  });
});
