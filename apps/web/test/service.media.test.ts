/**
 * StudioService media APIs (upload targets, confirmation, URL import,
 * listing) plus the read-side listing/estimate helpers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, makeModel, mockBinding, PNG_BYTES, rejection, StubProvider, VIDEO_MODEL } from "./_harness";
import { FAKE_STORAGE_ORIGIN } from "./_fake-supabase";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createUploadTarget", () => {
  it("creates a pending asset in the uploads bucket and returns a signed upload url", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const target = await h.service.createUploadTarget(h.principal, { filename: "Photo.PNG", contentType: "image/png" });
    expect(target).toEqual({
      asset_id: expect.any(String),
      method: "PUT",
      headers: { "content-type": "image/png" },
      expires_at: h.clock.isoAt(60 * 60 * 1000),
      upload_url: `${FAKE_STORAGE_ORIGIN}/storage/v1/object/upload/sign/uploads/${ws}/2026/09/${target.asset_id}.png?token=${target.token}`,
      token: expect.stringMatching(/^upload-\d+$/),
      object_path: `${ws}/2026/09/${target.asset_id}.png`,
    });
    expect(h.asset(target.asset_id)).toMatchObject({ workspace_id: ws, created_by: "user-alice", kind: "image", origin: "upload", status: "pending", bucket: "uploads", object_path: target.object_path, content_type: "image/png", bytes: null, metadata: { filename: "Photo.PNG" } });
    expect(h.storage.has("uploads", target.object_path)).toBe(false);
  });

  it("derives kind and extension from the content type, filename or hint", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const video = await h.service.createUploadTarget(h.principal, { filename: "clip.mov", contentType: "video/quicktime" });
    expect(video.object_path).toBe(`${ws}/2026/09/${video.asset_id}.mov`);
    const audio = await h.service.createUploadTarget(h.principal, { filename: "voice.wav", contentType: "audio/x-wav" });
    expect(h.asset(audio.asset_id).kind).toBe("audio");
    const custom = await h.service.createUploadTarget(h.principal, { filename: "mesh.obj", contentType: "application/x-thing", kind: "model" });
    expect(custom.object_path).toBe(`${ws}/2026/09/${custom.asset_id}.obj`);
    const bare = await h.service.createUploadTarget(h.principal, { filename: "noext", contentType: "application/octet-stream" });
    expect(bare.object_path).toBe(`${ws}/2026/09/${bare.asset_id}.bin`);
  });
});

describe("confirmUpload", () => {
  it("marks the asset ready (with its size) once the object exists in storage", async () => {
    const h = createHarness();
    const target = await h.service.createUploadTarget(h.principal, { filename: "photo.png", contentType: "image/png" });

    const early = await rejection(h.service.confirmUpload(h.principal, target.asset_id));
    expect(early.code).toBe("invalid_request");
    expect(early.message).toContain("PUT the bytes first");
    expect(h.asset(target.asset_id).status).toBe("pending");

    h.storage.put("uploads", target.object_path, PNG_BYTES, "image/png");
    const confirmed = await h.service.confirmUpload(h.principal, target.asset_id);
    expect(confirmed).toMatchObject({ id: target.asset_id, status: "ready", bytes: PNG_BYTES.byteLength, bucket: "uploads", object_path: target.object_path });
    expect(h.asset(target.asset_id)).toMatchObject({ status: "ready", bytes: PNG_BYTES.byteLength });

    // The confirmed upload resolves to a signed url from the uploads bucket when used as reference media.
    const view = await h.create({ medias: [{ role: "image_references", value: target.asset_id }] });
    expect(h.mockJob(view.id).input.medias[0]?.url).toContain(`/storage/v1/object/sign/uploads/${target.object_path}?token=`);
  });

  it("rejects unknown assets, other workspaces and assets without an upload target", async () => {
    const h = createHarness();
    expect((await rejection(h.service.confirmUpload(h.principal, "missing"))).code).toBe("not_found");

    const target = await h.service.createUploadTarget(h.principal, { filename: "photo.png", contentType: "image/png" });
    h.storage.put("uploads", target.object_path, PNG_BYTES, "image/png");
    expect((await rejection(h.service.confirmUpload({ workspaceId: h.otherWorkspace.id, userId: "user-bob" }, target.asset_id))).code).toBe("not_found");

    const noTarget = h.db.seed("media_assets", { workspace_id: h.workspace.id, kind: "image", origin: "upload", bucket: "uploads" });
    const err = await rejection(h.service.confirmUpload(h.principal, noTarget.id));
    expect(err.code).toBe("invalid_request");
    expect(err.message).toContain("no upload target");
  });

  it("only matches the exact object name within its folder", async () => {
    const h = createHarness();
    const target = await h.service.createUploadTarget(h.principal, { filename: "photo.png", contentType: "image/png" });
    h.storage.put("uploads", `${target.object_path}.tmp`, PNG_BYTES, "image/png");
    expect((await rejection(h.service.confirmUpload(h.principal, target.asset_id))).code).toBe("invalid_request");
  });
});

describe("importMediaUrl", () => {
  const URL_PNG = "https://cdn.example/pics/fox.png?v=1";

  it("probes the url, copies it into storage and returns a ready asset", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const asset = await h.service.importMediaUrl(h.principal, URL_PNG);
    expect(h.fetch.calls).toEqual([
      { url: URL_PNG, method: "HEAD", headers: {} },
      { url: URL_PNG, method: "GET", headers: {} },
    ]);
    expect(asset).toMatchObject({ workspace_id: ws, created_by: "user-alice", kind: "image", origin: "import", status: "ready", bucket: "media", object_path: `${ws}/2026/09/${asset.id}.png`, content_type: "image/png", bytes: PNG_BYTES.byteLength, source_url: URL_PNG });
    expect(h.storage.get("media", asset.object_path!)).toMatchObject({ bytes: PNG_BYTES, contentType: "image/png" });
    expect(h.asset(asset.id)).toEqual(asset);
  });

  it("uses the kind hint and the url extension when the content type is unknown", async () => {
    const h = createHarness();
    h.fetch.respond((call) => {
      if (call.method === "HEAD") throw new Error("HEAD probe refused");
      return new Response(PNG_BYTES as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
    });
    const asset = await h.service.importMediaUrl(h.principal, "https://cdn.example/clips/take1.MP4", "video");
    expect(asset).toMatchObject({ kind: "video", status: "ready", content_type: "application/octet-stream", object_path: `${h.workspace.id}/2026/09/${asset.id}.mp4` });

    const untyped = await h.service.importMediaUrl(h.principal, "https://cdn.example/blob");
    expect(untyped).toMatchObject({ kind: "file", object_path: `${h.workspace.id}/2026/09/${untyped.id}.bin` });
  });

  it("keeps the source url and marks the asset failed when the copy fails", async () => {
    const h = createHarness();
    h.fetch.respond((call) => (call.method === "HEAD" ? undefined : new Response("gone", { status: 404 })));
    const asset = await h.service.importMediaUrl(h.principal, URL_PNG);
    expect(asset).toMatchObject({ status: "failed", object_path: null, bytes: null, source_url: URL_PNG, metadata: { copy_error: { message: "fetch 404" } } });
    expect(h.storage.paths("media")).toEqual([]);
  });

  it("rejects non-https and private-network urls before creating anything", async () => {
    const h = createHarness();
    for (const [url, fragment] of [
      ["http://cdn.example/fox.png", "only https"],
      ["https://127.0.0.1/fox.png", "private network"],
      ["https://intranet.local/fox.png", "private network"],
      ["https://[::1]/fox.png", "private network"],
      ["https://172.16.0.9/fox.png", "private network"],
    ] as const) {
      const err = await rejection(h.service.importMediaUrl(h.principal, url));
      expect(err.code, url).toBe("invalid_request");
      expect(err.message, url).toContain(fragment);
    }
    expect(h.fetch.calls).toEqual([]);
    expect(h.db.rows("media_assets")).toEqual([]);
  });
});

describe("listMedia", () => {
  it("searches the denormalised prompt/title and filters by model (asset memory)", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const fox = h.seedReadyAsset({ id: "fox", prompt: "A red fox in the snow", model_id: "fixture_image" });
    h.clock.advance(1_000);
    const owl = h.seedReadyAsset({ id: "owl", title: "Night owl", prompt: "an owl at dusk", model_id: "other_model" });
    h.clock.advance(1_000);
    const plain = h.seedReadyAsset({ id: "plain" });

    expect((await h.service.listMedia(ws, { q: "FOX" })).items.map((i) => i.id)).toEqual([fox.id]);
    expect((await h.service.listMedia(ws, { q: "owl" })).items.map((i) => i.id)).toEqual([owl.id]);
    expect((await h.service.listMedia(ws, { q: "night" })).items.map((i) => i.id)).toEqual([owl.id]);
    expect((await h.service.listMedia(ws, { modelId: "fixture_image" })).items.map((i) => i.id)).toEqual([fox.id]);
    // Punctuation that would break the PostgREST filter syntax is neutralised, not forwarded.
    expect((await h.service.listMedia(ws, { q: 'red,(fox)"%' })).items.map((i) => i.id)).toEqual([fox.id]);
    expect((await h.service.listMedia(ws, { q: "   " })).items.map((i) => i.id)).toEqual([plain.id, owl.id, fox.id]);
  });

  it("lists ready assets newest first with signed urls and cursor pagination", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const a1 = h.seedReadyAsset({ id: "a1" });
    h.clock.advance(1_000);
    const a2 = h.seedReadyAsset({ id: "a2" });
    h.clock.advance(1_000);
    const a3 = h.seedReadyAsset({ id: "a3", kind: "video", object_path: `${ws}/2026/09/a3.mp4`, content_type: "video/mp4" });
    h.db.seed("media_assets", { id: "pending", workspace_id: ws, kind: "image", origin: "upload", status: "pending" });
    h.seedReadyAsset({ id: "foreign" }, h.otherWorkspace.id);

    const page1 = await h.service.listMedia(ws, { limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual([a3.id, a2.id]);
    expect(page1.items[0]!.url).toContain(`/storage/v1/object/sign/media/${a3.object_path}?token=`);
    expect(page1.items[1]!.url).toContain(`/sign/media/${a2.object_path}?token=`);
    expect(page1.items[0]).toMatchObject({ kind: "video", status: "ready", bytes: PNG_BYTES.byteLength });
    expect(page1.next_cursor).toBe(a2.created_at);

    const page2 = await h.service.listMedia(ws, { limit: 2, before: page1.next_cursor! });
    expect(page2.items.map((i) => i.id)).toEqual([a1.id]);
    expect(page2.next_cursor).toBeNull();

    expect((await h.service.listMedia(ws)).items.map((i) => i.id)).toEqual([a3.id, a2.id, a1.id]);
    expect((await h.service.listMedia(ws, { kind: "video" })).items.map((i) => i.id)).toEqual([a3.id]);
    expect((await h.service.listMedia(h.otherWorkspace.id)).items.map((i) => i.id)).toEqual(["foreign"]);
  });

  it("clamps the page size and falls back to the source url when the object is missing", async () => {
    const h = createHarness();
    for (let i = 0; i < 3; i++) {
      h.seedReadyAsset({ id: `a${i}` });
      h.clock.advance(1);
    }
    const orphan = h.db.seed("media_assets", { id: "orphan", workspace_id: h.workspace.id, kind: "image", origin: "import", status: "ready", object_path: `${h.workspace.id}/2026/09/orphan.png`, source_url: "https://cdn.example/orphan.png" });
    const page = await h.service.listMedia(h.workspace.id, { limit: 0 });
    expect(page.items.map((i) => i.id)).toEqual([orphan.id]);
    expect(page.items[0]!.url).toBe("https://cdn.example/orphan.png");
    expect(page.next_cursor).toBe(orphan.created_at);
    expect((await h.service.listMedia(h.workspace.id, { limit: 1_000 })).items).toHaveLength(4);
  });
});

describe("listGenerations", () => {
  it("pages newest first and filters by state, type and batch", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const a = await h.create({}, { batchId: "batch-1" });
    h.clock.advance(1_000);
    const asset = h.seedReadyAsset();
    const b = await h.create({ model: VIDEO_MODEL.id, medias: [{ role: "start_image", value: asset.id }] });
    h.clock.advance(1_000);
    const c = await h.create({}, { batchId: "batch-1" });
    await h.settle(c.id);
    await h.create({}, { principal: { workspaceId: h.otherWorkspace.id, userId: "user-bob" } });

    const page1 = await h.service.listGenerations(ws, { limit: 2 });
    expect(page1.items.map((g) => g.id)).toEqual([c.id, b.id]);
    expect(page1.items[0]).toMatchObject({ state: "succeeded", outputs: [expect.objectContaining({ url: expect.stringContaining("/sign/media/") })] });
    expect(page1.next_cursor).toBe(b.created_at);

    const page2 = await h.service.listGenerations(ws, { limit: 2, before: page1.next_cursor! });
    expect(page2.items.map((g) => g.id)).toEqual([a.id]);
    expect(page2.next_cursor).toBeNull();

    expect((await h.service.listGenerations(ws, { state: "succeeded" })).items.map((g) => g.id)).toEqual([c.id]);
    expect((await h.service.listGenerations(ws, { type: "video" })).items.map((g) => g.id)).toEqual([b.id]);
    expect((await h.service.listGenerations(ws, { batchId: "batch-1" })).items.map((g) => g.id)).toEqual([c.id, a.id]);
    expect((await h.service.listGenerations(ws, { limit: 0 })).items).toHaveLength(1);
    expect((await h.service.listGenerations(h.otherWorkspace.id)).items).toHaveLength(1);
    expect((await h.service.listGenerations("nobody")).items).toEqual([]);
  });
});

describe("estimate", () => {
  it("returns the normalised request and one estimate per available binding", async () => {
    const h = createHarness();
    const { request, estimates } = await h.service.estimate(h.workspace.id, { model: VIDEO_MODEL.id, duration: 7, medias: [{ role: "start_image", value: "asset-x" }] });
    expect(request).toMatchObject({ duration: 5, adjustments: [{ field: "duration", from: 7, to: 5 }] });
    expect(estimates).toEqual([expect.objectContaining({ provider: "mock", endpoint: "mock/fixture-video", usd: 0.25, unit: "second", quantity: 5, unitPriceUsd: 0.05, verified: false })]);
    expect((await h.service.estimate(h.workspace.id, { model: "fixture_image", prompt: "x" }, "fal")).estimates).toEqual([]);
    expect(h.service.models.has("fixture_image")).toBe(true);
  });

  it("uses the download content type when the HEAD probe is unavailable", async () => {
    const h = createHarness();
    h.fetch.respond((call) => call.method === "HEAD"
      ? new Response(null, { status: 405 })
      : new Response(PNG_BYTES as BodyInit, { status: 200, headers: { "content-type": "image/webp" } }));
    const asset = await h.service.importMediaUrl(h.principal, "https://cdn.example/pics/recovered.webp", "image");
    expect(asset).toMatchObject({ status: "ready", content_type: "image/webp", object_path: `${h.workspace.id}/2026/09/${asset.id}.webp` });
  });

  it("places an account-specific Higgsfield quote ahead of higher catalog estimates", async () => {
    const higgsfield = Object.assign(new StubProvider("higgsfield"), { quote: async () => 0.015 });
    const model = makeModel({ bindings: [mockBinding(), mockBinding({ provider: "higgsfield", endpoint: "higgsfield-ai/soul/v2/standard", pricing: undefined })] });
    const h = createHarness({ providers: [higgsfield], models: [model], strategy: "cheapest" });
    const { estimates } = await h.service.estimate(h.workspace.id, { model: model.id, prompt: "a fox" });
    expect(estimates.map((e) => [e.provider, e.usd])).toEqual([["higgsfield", 0.015], ["mock", 0.1]]);
  });

  it("uses a labeled catalog estimate when Higgsfield only returns descriptive pricing", async () => {
    const higgsfield = Object.assign(new StubProvider("higgsfield"), { quote: async () => undefined });
    const model = makeModel({ bindings: [mockBinding(), mockBinding({ provider: "higgsfield", endpoint: "bytedance/seedance-2.5/text-to-video", pricing: { unit: "image", usd: 0.12, verified: false } })] });
    const h = createHarness({ providers: [higgsfield], models: [model], strategy: "cheapest" });
    const { estimates } = await h.service.estimate(h.workspace.id, { model: model.id, prompt: "a fox" });
    expect(estimates.map((e) => [e.provider, e.usd, e.verified])).toEqual([["mock", 0.1, false], ["higgsfield", 0.12, false]]);
    expect(estimates[1]?.breakdown).toContain("descriptive pricing");
  });
});
