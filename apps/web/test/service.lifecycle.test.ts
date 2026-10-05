/**
 * StudioService job lifecycle after submission: poll-on-read, provider
 * failures, webhooks, reconciliation, long-polling and cancellation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockArtworkDataUrl, StudioError, type WebhookRequest } from "@reflow/core";
import { createHarness, JOB_TIMEOUT_MS, PNG_BYTES, POLL_MIN_INTERVAL_MS, rejection, T0, UnsignedMockProvider } from "./_harness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PROVIDER_URL = "https://placehold.co/1024x1024.png?model=fixture_image&i=0";

describe("poll-on-read (getGeneration with refresh)", () => {
  it("polls the provider, honours the 3 s rate limit, stores outputs and settles on success", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const { id } = await h.create();

    // Plain reads never poll.
    expect((await h.service.getGeneration(id, { workspaceId })).state).toBe("queued");
    expect(h.mockJob(id).polls).toBe(0);

    // First refresh: running, next poll scheduled with a 5 s backoff.
    const running = await h.service.getGeneration(id, { workspaceId, refresh: true });
    expect(running).toMatchObject({ state: "running", progress: 50, queue_position: null, outputs: [] });
    expect(h.mockJob(id).polls).toBe(1);
    expect(h.gen(id)).toMatchObject({ state: "running", progress: 50, last_polled_at: h.clock.iso(), next_poll_at: h.clock.isoAt(5_000) });
    expect(h.events(id).at(-1)).toMatchObject({ kind: "poll", state: "running", provider_job_id: h.gen(id).provider_job_id, payload: null });

    // Within 3 s of the last poll the row is served as-is.
    h.clock.advance(POLL_MIN_INTERVAL_MS - 1);
    expect((await h.service.getGeneration(id, { workspaceId, refresh: true })).state).toBe("running");
    expect(h.mockJob(id).polls).toBe(1);

    // Once the interval has passed the provider is polled again and reports success.
    h.clock.advance(1);
    const done = await h.service.getGeneration(id, { workspaceId, refresh: true });
    expect(h.mockJob(id).polls).toBe(2);
    expect(done).toMatchObject({ state: "succeeded", progress: 100, error: null, cost_estimate_usd: 0.1, cost_actual_usd: 0.1, finished_at: h.clock.iso() });
    expect(done.outputs).toEqual([{ index: 0, kind: "image", asset_id: expect.any(String), url: expect.stringContaining("/storage/v1/object/sign/media/"), provider_url: PROVIDER_URL, width: 1024, height: 1024, duration_seconds: null }]);

    // The output was fetched from the provider and copied into the media bucket.
    expect(h.fetch.calls).toEqual([{ url: PROVIDER_URL, method: "GET", headers: {} }]);
    const asset = h.asset(done.outputs[0]!.asset_id!);
    expect(asset).toMatchObject({ workspace_id: workspaceId, created_by: "user-alice", kind: "image", origin: "generated", status: "ready", bucket: "media", object_path: `${workspaceId}/2026/09/${asset.id}.png`, prompt: "a red fox", model_id: "fixture_image", content_type: "image/png", bytes: PNG_BYTES.byteLength, width: 1024, height: 1024, source_url: PROVIDER_URL, source_job_id: id, metadata: { seed: null } });
    expect(h.storage.get("media", asset.object_path!)).toMatchObject({ bytes: PNG_BYTES, contentType: "image/png" });
    expect(done.outputs[0]!.url).toContain(`/sign/media/${asset.object_path}?token=`);
    expect(h.db.rows("generation_outputs").filter((o) => o.generation_id === id)).toEqual([expect.objectContaining({ index: 0, asset_id: asset.id, provider_url: PROVIDER_URL, kind: "image", seed: null, metadata: { width: 1024, height: 1024, duration_seconds: null } })]);

    // Finalised row + ledger: release the reservation, settle at the estimate.
    expect(h.gen(id)).toMatchObject({ state: "succeeded", progress: 100, finished_at: h.clock.iso(), last_polled_at: h.clock.iso(), next_poll_at: null, cost_actual_usd: 0.1, cost_native: null });
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
      ["settlement", 0.1],
    ]);
    expect(h.ledger(id)[2]).toMatchObject({ provider: "mock", amount_native: null, native_unit: null, note: "estimated cost" });
    expect(h.events(id).map((e) => [e.kind, e.state])).toEqual([
      ["submit", "queued"],
      ["poll", "running"],
      ["poll", "succeeded"],
    ]);

    // Terminal generations are never polled again.
    h.clock.advance(60_000);
    await h.service.getGeneration(id, { workspaceId, refresh: true });
    expect(h.mockJob(id).polls).toBe(2);
    expect(h.db.violations).toEqual([]);
  });

  it("stores one asset per output for multi-image generations", async () => {
    const h = createHarness();
    const { id } = await h.create({ count: 3 });
    const done = await h.settle(id);
    expect(done.outputs.map((o) => [o.index, o.provider_url])).toEqual([
      [0, "https://placehold.co/1024x1024.png?model=fixture_image&i=0"],
      [1, "https://placehold.co/1024x1024.png?model=fixture_image&i=1"],
      [2, "https://placehold.co/1024x1024.png?model=fixture_image&i=2"],
    ]);
    expect(new Set(done.outputs.map((o) => o.asset_id)).size).toBe(3);
    expect(h.fetch.calls.map((c) => c.url)).toEqual(done.outputs.map((o) => o.provider_url));
    expect(h.storage.paths("media")).toHaveLength(3);
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.3],
      ["release", -0.3],
      ["settlement", 0.3],
    ]);
  });

  it("keeps the provider url when the copy into storage fails", async () => {
    const h = createHarness();
    h.fetch.respond(() => new Response("gone", { status: 500 }));
    const { id } = await h.create();
    const done = await h.settle(id);
    expect(done.state).toBe("succeeded");
    expect(done.outputs[0]).toMatchObject({ url: PROVIDER_URL, provider_url: PROVIDER_URL });
    expect(h.asset(done.outputs[0]!.asset_id!)).toMatchObject({ status: "failed", object_path: null, bytes: null, metadata: { seed: null, copy_error: { message: "fetch 500" } } });
    expect(h.storage.paths("media")).toEqual([]);
    expect(h.ledgerSummary(id)).toHaveLength(3);
  });

  it("scopes reads to the workspace", async () => {
    const h = createHarness();
    const { id } = await h.create();
    expect((await rejection(h.service.getGeneration(id, { workspaceId: h.otherWorkspace.id }))).code).toBe("not_found");
    expect((await rejection(h.service.getGeneration("missing", {}))).status).toBe(404);
    await expect(h.service.getGeneration(id)).resolves.toMatchObject({ id, state: "queued" });
  });
});

describe("provider failure", () => {
  it("marks the generation failed with the provider error and releases the reservation only", async () => {
    const h = createHarness();
    const { id } = await h.create({ prompt: "[fail] a red fox" });
    const done = await h.settle(id);
    expect(done).toMatchObject({ state: "failed", error: { code: "mock_failure", message: "prompt contained the fail marker" }, cost_estimate_usd: 0.1, cost_actual_usd: null, outputs: [], finished_at: h.clock.iso() });
    expect(h.gen(id)).toMatchObject({ state: "failed", progress: 50, next_poll_at: null, last_polled_at: h.clock.iso() });
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(h.ledger(id)[1]?.note).toBe("release reservation (failed)");
    expect(h.db.rows("media_assets")).toEqual([]);
    expect(h.db.rows("generation_outputs")).toEqual([]);
    expect(h.fetch.calls).toEqual([]);
  });

  it("records a failed status poll, schedules a retry in 30 s and serves the last known state", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const { id } = await h.create();
    vi.spyOn(h.mock, "getStatus").mockRejectedValueOnce(new Error("status endpoint 502"));

    // A provider outage must not turn a read into a 5xx: the stale row is returned and the error is recorded.
    expect((await h.service.getGeneration(id, { workspaceId, refresh: true })).state).toBe("queued");
    expect(h.gen(id)).toMatchObject({ state: "queued", last_polled_at: h.clock.iso(), next_poll_at: h.clock.isoAt(30_000) });
    expect(h.events(id).at(-1)).toMatchObject({ kind: "poll", state: null, payload: { error: { message: "status endpoint 502" } } });
    expect(h.ledgerSummary(id)).toEqual([["reservation", 0.1]]);

    h.clock.advance(POLL_MIN_INTERVAL_MS);
    expect((await h.service.getGeneration(id, { workspaceId, refresh: true })).state).toBe("running");
    // A successful poll clears the consecutive-error counter.
    expect(h.gen(id).provider_ref).not.toHaveProperty("poll_errors");
  });

  it("gives up after repeated consecutive poll errors that span at least two minutes", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const { id } = await h.create();
    vi.spyOn(h.mock, "getStatus").mockRejectedValue(new StudioError("provider_unavailable", "result fetch 503", { retryable: true }));

    // Five quick failures are not enough on their own: the errors must also span two minutes.
    for (let i = 0; i < 5; i++) {
      await h.service.getGeneration(id, { workspaceId, refresh: true });
      h.clock.advance(POLL_MIN_INTERVAL_MS);
    }
    expect(h.gen(id)).toMatchObject({ state: "queued", provider_ref: expect.objectContaining({ poll_errors: 5 }) });

    h.clock.advance(2 * 60 * 1000);
    const view = await h.service.getGeneration(id, { workspaceId, refresh: true });
    expect(view.state).toBe("failed");
    expect(h.gen(id).error).toMatchObject({ code: "poll_failed", last_error: { code: "provider_unavailable", message: "result fetch 503" } });
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
  });
});

describe("inline (data URL) outputs", () => {
  it("decodes SVG data URLs into storage without fetching", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const { id } = await h.create();
    const url = mockArtworkDataUrl({ seed: 7, width: 64, height: 64 });
    vi.spyOn(h.mock, "getStatus").mockResolvedValue({ state: "succeeded", outputs: [{ kind: "image", url, content_type: "image/svg+xml", width: 64, height: 64 }], costUsd: 0 });

    const view = await h.service.getGeneration(id, { workspaceId, refresh: true });
    expect(view.state).toBe("succeeded");
    expect(h.fetch.calls).toHaveLength(0);
    const assetId = view.outputs[0]!.asset_id!;
    expect(h.asset(assetId)).toMatchObject({ status: "ready", content_type: "image/svg+xml" });
    expect(h.asset(assetId).object_path).toMatch(/\.svg$/);
  });
});

describe("handleWebhook", () => {
  const request = (body: unknown): WebhookRequest => ({ headers: { "content-type": "application/json" }, rawBody: JSON.stringify(body) });
  const HOOK_URL = "https://placehold.co/1024x1024.png?model=hook&i=0";
  const payload = { images: [{ url: HOOK_URL, content_type: "image/png", width: 640, height: 480 }], seed: 42 };

  it("processes a succeeded webhook whose only proof of origin is a valid URL token", async () => {
    const h = createHarness({ mock: new UnsignedMockProvider({ runningPolls: 1 }) });
    const { id } = await h.create();
    const jobId = h.gen(id).provider_job_id!;
    const body = { providerJobId: jobId, state: "succeeded", payload };

    const result = await h.service.handleWebhook("mock", request(body), { generationId: id, token: await h.webhookToken(id) });
    expect(result).toEqual({ ok: true, generationId: id, state: "succeeded" });
    expect(h.mockJob(id).polls).toBe(0);
    expect(h.gen(id)).toMatchObject({ state: "succeeded", progress: 100, webhook_received_at: h.clock.iso(), webhook_verified: false, cost_actual_usd: 0.1, finished_at: h.clock.iso(), next_poll_at: null });

    const done = await h.service.getGeneration(id, { workspaceId: h.workspace.id });
    expect(done.outputs).toEqual([{ index: 0, kind: "image", asset_id: expect.any(String), url: expect.stringContaining("/sign/media/"), provider_url: HOOK_URL, width: 640, height: 480, duration_seconds: null }]);
    expect(h.asset(done.outputs[0]!.asset_id!)).toMatchObject({ status: "ready", source_url: HOOK_URL, metadata: { seed: 42 } });
    expect(h.db.rows("generation_outputs")[0]).toMatchObject({ generation_id: id, index: 0, seed: 42 });
    expect(h.fetch.calls.map((c) => c.url)).toEqual([HOOK_URL]);
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
      ["settlement", 0.1],
    ]);
    expect(h.events(id).at(-1)).toMatchObject({ kind: "webhook", verified: true, state: "succeeded", provider_job_id: jobId, payload: body });
  });

  it("ignores webhooks the provider could not verify when the URL token is wrong or missing", async () => {
    const h = createHarness({ mock: new UnsignedMockProvider() });
    const { id } = await h.create();
    const jobId = h.gen(id).provider_job_id!;
    const body = request({ providerJobId: jobId, state: "succeeded", payload });

    const attempts = [
      { generationId: id, token: "deadbeef" },
      { generationId: id, token: await h.webhookToken("another-generation") },
      { generationId: id, token: "not-hex!" },
      { generationId: id },
      {}, // found through the provider job id, still untrusted
    ];
    for (const hint of attempts) {
      expect(await h.service.handleWebhook("mock", body, hint), JSON.stringify(hint)).toEqual({ ok: false, generationId: id, reason: "unverified webhook" });
    }
    expect(h.gen(id)).toMatchObject({ state: "queued", webhook_received_at: null, webhook_verified: null, finished_at: null });
    expect(h.ledgerSummary(id)).toEqual([["reservation", 0.1]]);
    expect(h.db.rows("generation_outputs")).toEqual([]);
    const logged = h.events(id).filter((e) => e.kind === "webhook");
    expect(logged).toHaveLength(attempts.length);
    expect(logged.every((e) => e.verified === false && e.state === "succeeded")).toBe(true);

    // The right token still works afterwards.
    expect(await h.service.handleWebhook("mock", body, { generationId: id, token: await h.webhookToken(id) })).toMatchObject({ ok: true, state: "succeeded" });
  });

  it("trusts webhooks the provider verified itself and finds the row by provider job id", async () => {
    const h = createHarness();
    const { id } = await h.create();
    const jobId = h.gen(id).provider_job_id!;
    const result = await h.service.handleWebhook("mock", request({ providerJobId: jobId, state: "succeeded", payload }), {});
    expect(result).toEqual({ ok: true, generationId: id, state: "succeeded" });
    expect(h.gen(id)).toMatchObject({ state: "succeeded", webhook_verified: true });
  });

  it("acknowledges webhooks for terminal generations without touching them", async () => {
    const h = createHarness();
    const { id } = await h.create();
    await h.settle(id);
    const jobId = h.gen(id).provider_job_id!;
    const before = { row: h.gen(id), ledger: h.ledger(id), updates: h.db.log.filter((op) => op.op === "update").length, assets: h.db.rows("media_assets").length };

    const result = await h.service.handleWebhook("mock", request({ providerJobId: jobId, state: "failed" }), { generationId: id, token: await h.webhookToken(id) });
    expect(result).toEqual({ ok: true, generationId: id, state: "succeeded" });
    expect(h.gen(id)).toEqual(before.row);
    expect(h.ledger(id)).toEqual(before.ledger);
    expect(h.db.log.filter((op) => op.op === "update")).toHaveLength(before.updates);
    expect(h.db.rows("media_assets")).toHaveLength(before.assets);
    expect(h.events(id).at(-1)).toMatchObject({ kind: "webhook", state: "failed", verified: true });
  });

  it("reports unknown providers and generations (still logging the event)", async () => {
    const h = createHarness();
    expect(await h.service.handleWebhook("kie", request({}), {})).toEqual({ ok: false, reason: "unknown provider" });

    const missing = await h.service.handleWebhook("mock", request({ providerJobId: "mock_999_zzzzzz", state: "succeeded", payload }), { generationId: "no-such-generation", token: await h.webhookToken("no-such-generation") });
    expect(missing).toEqual({ ok: false, reason: "generation not found" });
    expect(h.db.rows("provider_events")).toEqual([expect.objectContaining({ provider: "mock", kind: "webhook", generation_id: null, provider_job_id: "mock_999_zzzzzz", verified: true, state: "succeeded" })]);
    expect(h.db.rows("generations")).toEqual([]);
  });

  it("falls back to polling the provider when a succeeded webhook yields no outputs", async () => {
    const h = createHarness({ runningPolls: 1 });
    const { id } = await h.create();
    const jobId = h.gen(id).provider_job_id!;

    const first = await h.service.handleWebhook("mock", request({ providerJobId: jobId, state: "succeeded", payload: { images: [] } }), {});
    expect(first).toEqual({ ok: true, generationId: id, state: "running" });
    expect(h.mockJob(id).polls).toBe(1);
    expect(h.gen(id)).toMatchObject({ state: "running", progress: 50, webhook_received_at: h.clock.iso(), webhook_verified: true, next_poll_at: h.clock.isoAt(5_000) });
    expect(h.events(id).map((e) => e.kind)).toEqual(["submit", "webhook", "poll"]);

    // A repeat webhook without a payload forces another poll even inside the rate-limit window.
    const second = await h.service.handleWebhook("mock", request({ providerJobId: jobId, state: "succeeded" }), {});
    expect(second).toEqual({ ok: true, generationId: id, state: "succeeded" });
    expect(h.mockJob(id).polls).toBe(2);
    const done = await h.service.getGeneration(id, { workspaceId: h.workspace.id });
    expect(done.outputs).toEqual([expect.objectContaining({ index: 0, provider_url: PROVIDER_URL, url: expect.stringContaining("/sign/media/") })]);
    expect(h.ledgerSummary(id)).toHaveLength(3);
  });

  it("finalises failed webhooks with a default error and releases the reservation", async () => {
    const h = createHarness();
    const { id } = await h.create();
    const jobId = h.gen(id).provider_job_id!;
    expect(await h.service.handleWebhook("mock", request({ providerJobId: jobId, state: "failed" }), {})).toEqual({ ok: true, generationId: id, state: "failed" });
    expect(h.gen(id)).toMatchObject({ state: "failed", error: { code: "failed", message: "generation failed" }, cost_actual_usd: null, finished_at: h.clock.iso() });
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(h.mockJob(id).polls).toBe(0);
  });
});

describe("reconcile", () => {
  it("refreshes queued/running generations whose next poll is null or overdue and reports counts", async () => {
    const h = createHarness();
    const due = await h.create();
    const neverPolled = await h.create();
    const future = await h.create();
    const finished = await h.create();
    h.db.patch("generations", due.id, { next_poll_at: h.clock.iso() }); // lte now
    h.db.patch("generations", neverPolled.id, { next_poll_at: null });
    h.db.patch("generations", future.id, { next_poll_at: h.clock.isoAt(1) });
    h.db.patch("generations", finished.id, { state: "succeeded", next_poll_at: null });

    expect(await h.service.reconcile()).toEqual({ checked: 2, updated: 2, failed: 0 });
    expect(h.gen(due.id)).toMatchObject({ state: "running", next_poll_at: h.clock.isoAt(5_000) });
    expect(h.gen(neverPolled.id).state).toBe("running");
    expect(h.gen(future.id).state).toBe("queued");
    expect(h.gen(finished.id).state).toBe("succeeded");
    expect([due, neverPolled, future, finished].map((g) => h.mockJob(g.id).polls)).toEqual([1, 1, 0, 0]);

    // Nothing is due until the scheduled next poll.
    expect(await h.service.reconcile()).toEqual({ checked: 0, updated: 0, failed: 0 });
    h.clock.advance(5_000);
    expect(await h.service.reconcile()).toEqual({ checked: 3, updated: 3, failed: 0 });
    expect([due, neverPolled, future].map((g) => h.gen(g.id).state)).toEqual(["succeeded", "succeeded", "running"]);
    expect(h.ledgerSummary(due.id).map(([type]) => type)).toEqual(["reservation", "release", "settlement"]);
  });

  it("counts provider errors as failed, keeps going, and processes oldest first within the limit", async () => {
    const h = createHarness();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await h.create()).id);
      h.clock.advance(1_000);
    }
    for (const id of ids) h.db.patch("generations", id, { next_poll_at: null });
    vi.spyOn(h.mock, "getStatus").mockRejectedValueOnce(new Error("status endpoint 502"));

    expect(await h.service.reconcile({ limit: 2 })).toEqual({ checked: 2, updated: 1, failed: 1 });
    expect(h.gen(ids[0]!)).toMatchObject({ state: "queued", last_polled_at: h.clock.iso(), next_poll_at: h.clock.isoAt(30_000) });
    expect(h.events(ids[0]!).at(-1)).toMatchObject({ kind: "poll", payload: { error: { message: "status endpoint 502" } } });
    expect(h.gen(ids[1]!).state).toBe("running");
    expect(h.gen(ids[2]!)).toMatchObject({ state: "queued", last_polled_at: null });

    // The third one is picked up next; the errored one waits for its 30 s retry.
    expect(await h.service.reconcile()).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(h.gen(ids[2]!).state).toBe("running");
  });

  it("times out generations older than 45 minutes without polling and releases the reservation", async () => {
    const h = createHarness();
    const { id } = await h.create();
    h.clock.advance(JOB_TIMEOUT_MS + 1);

    expect(await h.service.reconcile()).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(h.gen(id)).toMatchObject({ state: "failed", error: { code: "timeout", message: "generation exceeded the 45 minute limit" }, finished_at: h.clock.iso(), next_poll_at: null, cost_actual_usd: null });
    expect(h.mockJob(id).polls).toBe(0);
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(await h.service.reconcile()).toEqual({ checked: 0, updated: 0, failed: 0 });
  });

  it("applies the same timeout to refresh-on-read", async () => {
    const h = createHarness();
    const { id } = await h.create();
    h.clock.advance(JOB_TIMEOUT_MS + 1);
    const view = await h.service.getGeneration(id, { workspaceId: h.workspace.id, refresh: true });
    expect(view).toMatchObject({ state: "failed", error: { code: "timeout" } });
    expect(h.mockJob(id).polls).toBe(0);
  });
});

describe("waitForGenerations", () => {
  it("returns immediately with all_terminal=false when the timeout is 0 and a job is still running", async () => {
    const h = createHarness();
    const { id } = await h.create();
    const result = await h.service.waitForGenerations([id], { workspaceId: h.workspace.id, timeoutMs: 0 });
    expect(result.all_terminal).toBe(false);
    expect(result.items.map((g) => [g.id, g.state])).toEqual([[id, "running"]]);
    expect(h.mockJob(id).polls).toBe(1);
  });

  it("reports all_terminal=true once every generation has finished", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const ok = await h.create();
    const bad = await h.create({ prompt: "[fail] a red fox" });
    expect((await h.service.waitForGenerations([ok.id, bad.id], { workspaceId, timeoutMs: 0 })).all_terminal).toBe(false);

    h.clock.advance(POLL_MIN_INTERVAL_MS);
    const result = await h.service.waitForGenerations([ok.id, bad.id], { workspaceId, timeoutMs: 0 });
    expect(result.all_terminal).toBe(true);
    expect(result.items.map((g) => g.state)).toEqual(["succeeded", "failed"]);
    expect(result.items[0]!.outputs[0]!.url).toContain("/sign/media/");
    expect((await rejection(h.service.waitForGenerations(["missing"], { workspaceId, timeoutMs: 0 }))).code).toBe("not_found");
  });

  it("sleeps between refreshes and resolves as soon as the job turns terminal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
    const h = createHarness({ now: () => new Date(Date.now()) });
    const { id } = await h.create();

    const pending = h.service.waitForGenerations([id], { workspaceId: h.workspace.id, timeoutMs: 10_000 });
    // t=0 poll (running) → sleep 2 s → t=2 s rate-limited → sleep 2 s → t=4 s poll (succeeded).
    await vi.advanceTimersByTimeAsync(4_100);
    const result = await pending;
    expect(result.all_terminal).toBe(true);
    expect(result.items[0]).toMatchObject({ state: "succeeded", finished_at: new Date(T0 + 4_000).toISOString() });
    expect(h.mockJob(id).polls).toBe(2);
  });

  it("gives up at the deadline (capped at 25 s) while the job is still running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
    const h = createHarness({ now: () => new Date(Date.now()) });
    const { id } = await h.create();
    vi.spyOn(h.mock, "getStatus").mockResolvedValue({ state: "running", progress: 10 });

    const pending = h.service.waitForGenerations([id], { workspaceId: h.workspace.id, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(25_100);
    const result = await pending;
    expect(result.all_terminal).toBe(false);
    expect(result.items[0]!.state).toBe("running");
    expect(Date.now()).toBe(T0 + 25_100);
  });
});

describe("cancelGeneration", () => {
  it("cancels a running generation, tells the provider and releases the reservation", async () => {
    const h = createHarness();
    const workspaceId = h.workspace.id;
    const { id } = await h.create();
    await h.service.getGeneration(id, { workspaceId, refresh: true });
    const jobId = h.gen(id).provider_job_id!;
    const cancel = vi.spyOn(h.mock, "cancel");

    const view = await h.service.cancelGeneration(id, workspaceId);
    expect(cancel).toHaveBeenCalledWith({ provider: "mock", providerJobId: jobId, endpoint: "mock/fixture" });
    expect(h.mock.jobs.has(jobId)).toBe(false);
    expect(view).toMatchObject({ state: "cancelled", error: { code: "cancelled", message: "cancelled by user" }, finished_at: h.clock.iso(), cost_actual_usd: null, outputs: [] });
    expect(h.gen(id)).toMatchObject({ state: "cancelled", progress: 50, next_poll_at: null, last_polled_at: h.clock.iso() });
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
    expect(h.ledger(id)[1]?.note).toBe("release reservation (cancelled)");

    // Idempotent: a second cancel neither calls the provider nor writes the ledger.
    expect((await h.service.cancelGeneration(id, workspaceId)).state).toBe("cancelled");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.ledgerSummary(id)).toHaveLength(2);
    // ... and the reconciler no longer looks at it.
    h.clock.advance(60_000);
    expect(await h.service.reconcile()).toEqual({ checked: 0, updated: 0, failed: 0 });
  });

  it("cancels locally even when the provider call fails, and is scoped to the workspace", async () => {
    const h = createHarness();
    const { id } = await h.create();
    vi.spyOn(h.mock, "cancel").mockRejectedValue(new Error("provider down"));
    expect((await rejection(h.service.cancelGeneration(id, h.otherWorkspace.id))).code).toBe("not_found");
    expect(h.gen(id).state).toBe("queued");
    expect((await h.service.cancelGeneration(id, h.workspace.id)).state).toBe("cancelled");
    expect(h.ledgerSummary(id)).toEqual([
      ["reservation", 0.1],
      ["release", -0.1],
    ]);
  });
});
