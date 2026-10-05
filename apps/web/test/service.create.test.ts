/**
 * StudioService.createGeneration: normalisation, reservation, submission with
 * provider fallback, media resolution and the monthly budget guard.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ambiguousSubmit, HiggsfieldProvider, rejectedSubmit, StudioError } from "@reflow/core";
import { BASE_URL, createHarness, falBinding, makeModel, mockBinding, rejection, StubProvider, VIDEO_MODEL } from "./_harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createGeneration", () => {
  it("normalises the request, reserves the estimate, submits to the mock and returns a queued view", async () => {
    const h = createHarness();
    const view = await h.create({ prompt: "  a red fox  ", aspect_ratio: "4:3", params: { seed: 7, bogus: true } }, { idempotencyKey: "idem-1", batchId: "batch-1", folderId: "folder-1" });

    // View
    expect(view).toMatchObject({ model_id: "fixture_image", output_type: "image", provider: "mock", state: "queued", progress: null, error: null, cost_estimate_usd: 0.1, cost_actual_usd: null, finished_at: null, outputs: [] });
    expect(view.request).toEqual({ model: "fixture_image", prompt: "a red fox", aspect_ratio: "1:1", count: 1, medias: [], params: { seed: 7 }, adjustments: expect.any(Array) });
    expect(view.adjustments).toEqual([
      { field: "aspect_ratio", from: "4:3", to: "1:1", reason: "fixture_image does not support 4:3" },
      { field: "params.bogus", from: true, to: undefined, reason: "unknown parameter for fixture_image; ignored" },
    ]);

    // Row
    const row = h.gen(view.id);
    const jobId = row.provider_job_id;
    expect(jobId).toMatch(/^mock_1_/);
    expect(row).toMatchObject({
      workspace_id: h.workspace.id,
      created_by: "user-alice",
      api_key_id: "key-1",
      state: "queued",
      provider: "mock",
      provider_endpoint: "mock/fixture",
      provider_ref: { provider: "mock", providerJobId: jobId, endpoint: "mock/fixture" },
      provider_input: { prompt: "a red fox", aspect_ratio: "1:1", seed: 7 },
      idempotency_key: "idem-1",
      batch_id: "batch-1",
      folder_id: "folder-1",
      cost_estimate_usd: 0.1,
      started_at: h.clock.iso(),
      next_poll_at: h.clock.isoAt(10_000),
      last_polled_at: null,
    });
    expect(row.adjustments).toEqual(view.adjustments);

    // The mock received the webhook callback URL (base URL trailing slash stripped, signed token).
    const job = h.mockJob(view.id);
    expect(job.input.webhookUrl).toBe(`${BASE_URL.replace(/\/$/, "")}/api/webhooks/mock?g=${encodeURIComponent(view.id)}&t=${await h.webhookToken(view.id)}`);
    expect(job.input.jobId).toBe(view.id);
    expect(job.polls).toBe(0);

    // Ledger: reserve the highest candidate estimate, including fallback.
    expect(h.ledger(view.id)).toEqual([expect.objectContaining({ workspace_id: h.workspace.id, entry_type: "reservation", amount_usd: 0.1, provider: "mock", note: "highest known candidate estimate including fallback" })]);

    // Provider event: a queued submit.
    expect(h.events(view.id)).toEqual([expect.objectContaining({ provider: "mock", kind: "submit", state: "queued", provider_job_id: jobId, generation_id: view.id, payload: null })]);
    expect(h.db.violations).toEqual([]);
  });

  it("writes the count into the provider input and multiplies the estimate", async () => {
    const h = createHarness();
    const view = await h.create({ count: 10 });
    expect(view.adjustments).toEqual([{ field: "count", from: 10, to: 4, reason: "count capped at 4 for fixture_image" }]);
    expect(view.cost_estimate_usd).toBe(0.4);
    expect(h.gen(view.id).provider_input).toEqual({ prompt: "a red fox", aspect_ratio: "1:1", num_images: 4 });
    expect(h.ledgerSummary(view.id)).toEqual([["reservation", 0.4]]);
  });

  it("returns the existing generation for a repeated idempotency key without inserting or submitting again", async () => {
    const h = createHarness();
    const first = await h.create({}, { idempotencyKey: "idem-1" });
    const second = await h.create({ prompt: "something else entirely" }, { idempotencyKey: "idem-1" });
    expect(second.id).toBe(first.id);
    expect(second.request).toEqual(first.request);
    expect(h.db.rows("generations")).toHaveLength(1);
    expect(h.db.rows("ledger_entries")).toHaveLength(1);
    expect(h.mock.jobs.size).toBe(1);

    // Idempotency keys are scoped per workspace.
    const elsewhere = await h.create({}, { idempotencyKey: "idem-1", principal: { workspaceId: h.otherWorkspace.id, userId: "user-bob" } });
    expect(elsewhere.id).not.toBe(first.id);
    expect(h.db.rows("generations")).toHaveLength(2);
  });

  it("rejects unknown models and invalid requests before touching the database", async () => {
    const h = createHarness();
    expect((await rejection(h.create({ model: "nope" }))).code).toBe("model_not_found");
    const invalid = await rejection(h.create({ prompt: "" }));
    expect(invalid.code).toBe("invalid_request");
    expect(invalid.message).toContain("prompt is required");
    expect(h.db.rows("generations")).toHaveLength(0);
    expect(h.db.rows("ledger_entries")).toHaveLength(0);
    expect(h.mock.jobs.size).toBe(0);
  });

  it("fails with provider_unavailable when no configured provider serves the model", async () => {
    const h = createHarness({ models: [makeModel({ bindings: [falBinding()] })] });
    const err = await rejection(h.create());
    expect(err.code).toBe("provider_unavailable");
    expect(err.status).toBe(503);
    expect(h.db.rows("generations")).toHaveLength(0);
  });

  it("honours a forced provider", async () => {
    const fal = new StubProvider("fal");
    const h = createHarness({ providers: [fal], models: [makeModel({ bindings: [falBinding(), mockBinding()] })] });
    const view = await h.create({}, { provider: "mock" });
    expect(view.provider).toBe("mock");
    expect(fal.submitCalls).toHaveLength(0);
    expect((await rejection(h.create({}, { provider: "kie" }))).code).toBe("provider_unavailable");
  });
});

describe("createGeneration fallback", () => {
  const FALLBACK_MODEL = makeModel({ id: "fixture_fallback", bindings: [falBinding(), mockBinding()] });

  it("moves to the next candidate when the preferred provider is unavailable", async () => {
    const fal = new StubProvider("fal");
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const view = await h.create({ model: FALLBACK_MODEL.id });

    expect(fal.submitCalls).toHaveLength(1);
    expect(view.provider).toBe("mock");
    expect(h.gen(view.id)).toMatchObject({ state: "queued", provider: "mock", provider_endpoint: "mock/fixture" });
    // The more expensive fallback is covered before submission; the final row shows its estimate.
    expect(h.ledger(view.id)).toEqual([expect.objectContaining({ entry_type: "reservation", amount_usd: 0.1, provider: "fal" })]);
    expect(h.gen(view.id).cost_estimate_usd).toBe(0.1);
    expect(h.events(view.id)).toEqual([
      expect.objectContaining({ provider: "fal", kind: "submit", state: null, provider_job_id: null, payload: { error: { message: "fal is down", code: "provider_unavailable" } } }),
      expect.objectContaining({ provider: "mock", kind: "submit", state: "queued" }),
    ]);
  });

  it("checks the more expensive fallback against the monthly cap before submitting", async () => {
    const fal = new StubProvider("fal");
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL], monthlyBudgetUsd: 0.05 });
    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.code).toBe("insufficient_credits");
    expect(fal.submitCalls).toHaveLength(0);
    expect(h.mock.jobs.size).toBe(0);
  });

  it("does not submit to a second provider after an ambiguous transport failure", async () => {
    const fal = new StubProvider("fal", { submitError: () => new StudioError("provider_unavailable", "connection lost after POST", { details: { submissionOutcome: "unknown" }, retryable: false }) });
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const submit = vi.spyOn(h.mock, "submit");
    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.details).toEqual({ submissionOutcome: "unknown" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("fails closed with submit_ambiguous when the provider may have accepted the job", async () => {
    const fal = new StubProvider("fal", { submitError: () => ambiguousSubmit("provider_error", "gateway timeout after POST") });
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const submit = vi.spyOn(h.mock, "submit");
    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.submissionOutcome).toBe("unknown");
    expect(submit).not.toHaveBeenCalled();
    const [row] = h.db.rows("generations");
    expect(row).toMatchObject({ state: "failed", error: { code: "submit_ambiguous" } });
    expect((row!.error as { message: string }).message).toContain("gateway timeout after POST");
    expect(h.ledger(row!.id).map((e) => [e.entry_type, e.amount_usd, e.note])).toEqual([
      ["reservation", 0.1, "highest known candidate estimate including fallback"],
      ["release", -0.1, "submission outcome unknown"],
    ]);
  });

  it("does not fall back on an untagged provider error (fail closed)", async () => {
    const fal = new StubProvider("fal", { submitError: () => new StudioError("provider_error", "unexpected response") });
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const submit = vi.spyOn(h.mock, "submit");
    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.code).toBe("provider_error");
    expect(submit).not.toHaveBeenCalled();
    expect(h.db.rows("generations")[0]).toMatchObject({ state: "failed", error: { code: "submit_failed", message: "unexpected response" } });
  });

  it("fails the row, releases the reservation and rethrows when every candidate fails", async () => {
    const fal = new StubProvider("fal");
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    vi.spyOn(h.mock, "submit").mockRejectedValue(rejectedSubmit("provider_rate_limited", "mock is throttled"));

    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.code).toBe("provider_rate_limited");
    expect(err.message).toBe("mock is throttled");

    const [row] = h.db.rows("generations");
    expect(row).toMatchObject({ state: "failed", provider: null, provider_job_id: null, error: { code: "submit_failed", message: "mock is throttled" }, finished_at: h.clock.iso() });
    expect(h.ledgerSummary(row!.id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(h.events(row!.id).map((e) => [e.provider, e.state])).toEqual([
      ["fal", null],
      ["mock", null],
    ]);
  });

  it("wraps non-StudioError failures as provider_error and does not fall back", async () => {
    const fal = new StubProvider("fal", { submitError: () => new TypeError("fetch failed") });
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const submit = vi.spyOn(h.mock, "submit");

    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.code).toBe("provider_error");
    expect(err.message).toBe("fetch failed");
    expect(err.cause).toBeInstanceOf(TypeError);
    expect(submit).not.toHaveBeenCalled();
    expect(h.db.rows("generations")[0]?.error).toEqual({ code: "submit_failed", message: "fetch failed" });
  });

  it("stops the fallback loop on invalid_request but not on provider auth errors", async () => {
    const fal = new StubProvider("fal", { submitError: () => new StudioError("invalid_request", "prompt violates content policy") });
    const h = createHarness({ providers: [fal], models: [FALLBACK_MODEL] });
    const submit = vi.spyOn(h.mock, "submit");

    const err = await rejection(h.create({ model: FALLBACK_MODEL.id }));
    expect(err.code).toBe("invalid_request");
    expect(submit).not.toHaveBeenCalled();
    const [row] = h.db.rows("generations");
    expect(row).toMatchObject({ state: "failed", error: { code: "submit_failed", message: "prompt violates content policy" } });
    expect(h.ledgerSummary(row!.id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(h.events(row!.id)).toHaveLength(1);

    // A provider-side auth failure (expired key) is an infrastructure problem: the next candidate is tried.
    const unauthorized = new StubProvider("fal", { submitError: () => new StudioError("unauthorized", "bad key") });
    const h2 = createHarness({ providers: [unauthorized], models: [FALLBACK_MODEL] });
    const submit2 = vi.spyOn(h2.mock, "submit");
    const view = await h2.create({ model: FALLBACK_MODEL.id });
    expect(submit2).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({ state: "queued", provider: "mock" });
  });
});

describe("Higgsfield API routing", () => {
  it("quotes the exact request before submitting through the same MCP service", async () => {
    const calls: string[] = [];
    const provider = new HiggsfieldProvider({
      credential: "id:secret",
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).includes("/estimate/")) return Response.json({ usd: "0.025", credits: "0.5" });
        if (String(url).endsWith("/status")) return Response.json({ status: "completed", request_id: "hf-job-1", images: [{ url: "https://cdn.example/hf.png" }] });
        return Response.json({ status: "queued", request_id: "hf-job-1", status_url: "https://platform.higgsfield.ai/requests/hf-job-1/status" });
      },
    });
    const model = makeModel({ bindings: [mockBinding(), mockBinding({ provider: "higgsfield", endpoint: "higgsfield-ai/soul/v2/standard", pricing: undefined })] });
    const h = createHarness({ providers: [provider], models: [model], strategy: "cheapest" });
    const view = await h.create({ model: model.id });
    expect(view).toMatchObject({ provider: "higgsfield", state: "queued", cost_estimate_usd: 0.025 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("/estimate/higgsfield-ai/soul/v2/standard");
    expect(calls[1]).toContain("/higgsfield-ai/soul/v2/standard?hf_webhook=");
    expect(h.ledgerSummary(view.id)).toEqual([["reservation", 0.1]]);
    const done = await h.settle(view.id);
    expect(done).toMatchObject({ state: "succeeded", cost_estimate_usd: 0.025, cost_actual_usd: null });
    expect(h.ledgerSummary(view.id)).toEqual([["reservation", 0.1], ["release", -0.1], ["settlement", 0.025]]);
    expect(h.ledger(view.id)[2]?.note).toContain("provisional account quote");
  });
});

describe("media resolution", () => {
  it("resolves a ready asset id to a signed storage URL", async () => {
    const h = createHarness();
    const asset = h.seedReadyAsset({ id: "asset-ref" });
    const view = await h.create({ model: VIDEO_MODEL.id, prompt: undefined, medias: [{ role: "start_image", value: asset.id }] });

    const { input } = h.mockJob(view.id);
    expect(input.medias).toEqual([{ role: "start_image", kind: "image", url: expect.stringContaining(`/storage/v1/object/sign/media/${asset.object_path}?token=`), source: asset.id }]);
    expect(h.gen(view.id).provider_input).toEqual({ image_url: input.medias[0]?.url, aspect_ratio: "16:9", duration: 5 });
    expect(view.cost_estimate_usd).toBe(0.25);
  });

  it("resolves a generation id to its first output (stored asset, else provider url)", async () => {
    const h = createHarness();
    const source = await h.create({ count: 2 });
    await h.settle(source.id);
    const [first, second] = h.db.rows("generation_outputs").filter((o) => o.generation_id === source.id).sort((a, b) => a.index - b.index);
    expect(first?.asset_id).toBeTruthy();

    const fromAsset = await h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: source.id }] });
    const resolved = h.mockJob(fromAsset.id).input.medias[0];
    expect(resolved).toMatchObject({ role: "start_image", kind: "image", source: source.id });
    expect(resolved?.url).toContain(`/storage/v1/object/sign/media/${h.asset(first!.asset_id!).object_path}`);
    expect(resolved?.url).not.toContain(second!.asset_id!);

    // Without a stored asset the provider URL is used as-is.
    h.db.patch("generation_outputs", first!.id, { asset_id: null, provider_url: "https://cdn.example/outputs/first.png" });
    const fromProvider = await h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: source.id }] });
    expect(h.mockJob(fromProvider.id).input.medias[0]?.url).toBe("https://cdn.example/outputs/first.png");
  });

  it("refuses generations of another workspace and generations without outputs", async () => {
    const h = createHarness();
    const foreign = await h.create({}, { principal: { workspaceId: h.otherWorkspace.id, userId: "user-bob" } });
    await h.settle(foreign.id, h.otherWorkspace.id);
    const err = await rejection(h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: foreign.id }] }));
    expect(err.code).toBe("media_unresolved");
    expect(err.message).toContain(`generation ${foreign.id} not found`);

    // Queued generation: no outputs yet → not found as a media source (falls through to "neither").
    const pending = await h.create();
    const noOutput = await rejection(h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: pending.id }] }));
    expect(noOutput.code).toBe("media_unresolved");
  });

  it("accepts https URLs only when allowUrls is set and rejects private-network targets", async () => {
    const h = createHarness();
    const url = "https://cdn.example/refs/fox.jpg";
    const denied = await rejection(h.create({ medias: [{ role: "image_references", value: url }] }));
    expect(denied.code).toBe("invalid_request");
    expect(denied.message).toContain("not URLs");

    const view = await h.create({ medias: [{ role: "image_references", value: url }] }, { allowUrls: true });
    expect(h.mockJob(view.id).input.medias).toEqual([{ role: "image_references", kind: "image", url, source: url }]);
    expect(h.gen(view.id).provider_input).toMatchObject({ image_urls: [url] });

    for (const bad of ["https://192.168.1.5/x.png", "https://localhost/x.png", "https://10.0.0.1/x.png", "https://metadata.internal/x.png", "https://169.254.169.254/latest"]) {
      const err = await rejection(h.create({ medias: [{ role: "image_references", value: bad }] }, { allowUrls: true }));
      expect(err.code, bad).toBe("invalid_request");
      expect(err.message, bad).toContain("private network");
    }
    // Nothing was inserted for the rejected requests.
    expect(h.db.rows("generations")).toHaveLength(1);
  });

  it("throws media_unresolved for ids that are neither assets nor generations, or assets of another workspace", async () => {
    const h = createHarness();
    const unknown = await rejection(h.create({ medias: [{ role: "image_references", value: "not-an-id" }] }));
    expect(unknown.code).toBe("media_unresolved");
    expect(unknown.status).toBe(400);
    expect(unknown.message).toContain("neither an asset id nor a generation id");

    const foreignAsset = h.seedReadyAsset({ id: "asset-foreign" }, h.otherWorkspace.id);
    expect((await rejection(h.create({ medias: [{ role: "image_references", value: foreignAsset.id }] }))).code).toBe("media_unresolved");
    expect(h.db.rows("generations")).toHaveLength(0);
  });

  it("falls back to the source url for assets that were never copied into storage", async () => {
    const h = createHarness();
    const asset = h.db.seed("media_assets", { id: "asset-remote", workspace_id: h.workspace.id, kind: "image", origin: "import", status: "failed", source_url: "https://cdn.example/remote.png" });
    const view = await h.create({ medias: [{ role: "image", value: asset.id }] });
    expect(view.adjustments).toEqual([{ field: "medias.role", from: "image", to: "image_references", reason: "fixture_image uses role image_references" }]);
    expect(h.mockJob(view.id).input.medias[0]?.url).toBe("https://cdn.example/remote.png");

    const empty = h.db.seed("media_assets", { id: "asset-empty", workspace_id: h.workspace.id, kind: "image", origin: "upload", status: "pending" });
    const err = await rejection(h.create({ medias: [{ role: "image_references", value: empty.id }] }));
    expect(err.code).toBe("media_unresolved");
    expect(err.message).toContain("no readable URL");
  });
});

describe("balance and monthly budget", () => {
  it("monthToDateSpend sums settlements and open reservations of the current month only", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    // Last month: settled $5 (excluded from month-to-date, included in the all-time balance view).
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "settlement", amount_usd: 5, created_at: "2026-08-20T12:00:00.000Z" });
    h.db.seed("ledger_entries", { workspace_id: ws, entry_type: "topup", amount_usd: -20, created_at: "2026-08-01T00:00:00.000Z" });
    // Another workspace is ignored entirely.
    h.db.seed("ledger_entries", { workspace_id: h.otherWorkspace.id, entry_type: "settlement", amount_usd: 99 });

    const done = await h.create();
    await h.settle(done.id); // reservation 0.1, release -0.1, settlement 0.1
    const asset = h.seedReadyAsset();
    await h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: asset.id }] }); // open reservation 0.25

    expect(await h.service.monthToDateSpend(ws)).toEqual({ settled_usd: 0.1, reserved_usd: 0.25 });
    expect(await h.service.balance(ws)).toEqual({ spent_usd: 5.1, reserved_usd: 0.25, budget_usd: 20, month_to_date_usd: 0.1, monthly_budget_usd: null, providers: [] });
    expect(await h.service.balance(h.otherWorkspace.id)).toMatchObject({ spent_usd: 99, reserved_usd: 0, month_to_date_usd: 99 });
  });

  it("never reports a negative reservation and includes provider balances", async () => {
    const fal = new StubProvider("fal", { balance: { native: 12.5, unit: "usd", usd: 12.5 } });
    const h = createHarness({ providers: [fal], monthlyBudgetUsd: 50 });
    h.db.seed("ledger_entries", { workspace_id: h.workspace.id, entry_type: "release", amount_usd: -0.3 });
    expect(await h.service.monthToDateSpend(h.workspace.id)).toEqual({ settled_usd: 0, reserved_usd: 0 });
    expect(await h.service.balance(h.workspace.id)).toMatchObject({ monthly_budget_usd: 50, providers: [{ provider: "fal", native: 12.5, unit: "usd", usd: 12.5 }] });
  });

  it("rejects a generation that would exceed the monthly budget with insufficient_credits (402)", async () => {
    const h = createHarness({ monthlyBudgetUsd: 0.4 });
    const done = await h.create();
    await h.settle(done.id); // settled 0.10
    const asset = h.seedReadyAsset();
    await h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: asset.id }] }); // reserved 0.25 → 0.45 > 0.40 for the next job

    const err = await rejection(h.create());
    expect(err.code).toBe("insufficient_credits");
    expect(err.status).toBe(402);
    expect(err.details).toEqual({ budget_usd: 0.4, settled_usd: 0.1, reserved_usd: 0.25, estimate_usd: 0.1 });
    expect(err.message).toContain("monthly budget of $0.40 would be exceeded");
    // The refused job keeps a failed row (and no reservation); nothing reached the provider.
    const rows = h.db.rows("generations");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ state: "failed", error: { code: "insufficient_credits" } });
    expect(h.ledger(rows[2]!.id)).toEqual([]);
    expect(h.mock.jobs.size).toBe(2);
    expect(h.db.rpcLog.filter((c) => c.fn === "reserve_budget").at(-1)?.args).toMatchObject({ p_amount_usd: 0.1, p_cap_usd: 0.4, p_month_start: "2026-09-01T00:00:00.000Z" });
  });

  it("allows spend up to exactly the budget, and last month's spend does not count", async () => {
    const h = createHarness({ monthlyBudgetUsd: 0.2 });
    h.db.seed("ledger_entries", { workspace_id: h.workspace.id, entry_type: "settlement", amount_usd: 100, created_at: "2026-08-31T23:59:59.000Z" });
    const first = await h.create();
    await h.settle(first.id); // settled 0.10
    await expect(h.create()).resolves.toMatchObject({ state: "queued" }); // 0.10 + 0.10 == 0.20
    expect((await rejection(h.create())).code).toBe("insufficient_credits");
  });

  it("does not consult the ledger when no budget is configured", async () => {
    const h = createHarness({ monthlyBudgetUsd: 0 });
    h.db.seed("ledger_entries", { workspace_id: h.workspace.id, entry_type: "settlement", amount_usd: 1_000_000 });
    await expect(h.create()).resolves.toMatchObject({ state: "queued" });
  });
});

describe("createGeneration bookkeeping", () => {
  it("stamps the app version and appends binding-level adjustments from the provider", async () => {
    const h = createHarness();
    const original = h.mock.submit.bind(h.mock);
    vi.spyOn(h.mock, "submit").mockImplementation(async (input) => ({ ...(await original(input)), adjustments: [{ field: "quality", from: "high", to: "basic", reason: "pinned by mock/fixture" }] }));
    const view = await h.create({ params: { seed: 1 } });
    expect(h.gen(view.id).app_version).toBe(process.env.VERCEL_GIT_COMMIT_SHA || "dev");
    expect(view.adjustments).toEqual(expect.arrayContaining([{ field: "quality", from: "high", to: "basic", reason: "pinned by mock/fixture" }]));
  });

  it("skips the budget call for free jobs without a cap", async () => {
    const h = createHarness({ models: [makeModel({ bindings: [mockBinding({ pricing: { unit: "image", usd: 0 } })] })] });
    await expect(h.create()).resolves.toMatchObject({ state: "queued" });
    expect(h.db.rpcLog.some((c) => c.fn === "reserve_budget")).toBe(false);
  });
});
