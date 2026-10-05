/**
 * StudioService delete APIs: deleteGenerations (finished jobs plus the media
 * they produced) and deleteMedia (assets plus their storage objects).
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, rejection, type Harness } from "./_harness";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A finished generation with its single generated asset. */
async function finished(h: Harness, request: Parameters<Harness["create"]>[0] = {}) {
  const created = await h.create(request);
  const done = await h.settle(created.id);
  expect(done.state).toBe("succeeded");
  const assetId = done.outputs[0]!.asset_id!;
  return { id: created.id, assetId, objectPath: h.asset(assetId).object_path! };
}

describe("deleteGenerations", () => {
  it("deletes a finished generation, its outputs, its generated media and the storage objects", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const gen = await finished(h);
    expect(h.storage.has("media", gen.objectPath)).toBe(true);

    const result = await h.service.deleteGenerations(ws, [gen.id]);

    expect(result).toEqual({ deleted: [gen.id], skipped: [] });
    expect(h.db.find("generations", gen.id)).toBeUndefined();
    expect(h.db.rows("generation_outputs").filter((o) => o.generation_id === gen.id)).toEqual([]);
    expect(h.db.find("media_assets", gen.assetId)).toBeUndefined();
    expect(h.storage.removeCalls).toEqual([{ bucket: "media", path: gen.objectPath }]);
    expect(h.storage.has("media", gen.objectPath)).toBe(false);
  });

  it("leaves ledger rows in place (generation_id set null) so spend history is unchanged", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const gen = await finished(h);
    const before = h.ledger(gen.id);
    expect(before.map((e) => e.entry_type)).toContain("settlement");
    const balanceBefore = await h.service.balance(ws);
    const monthBefore = await h.service.monthToDateSpend(ws);

    await h.service.deleteGenerations(ws, [gen.id]);

    const after = h.db.rows("ledger_entries");
    expect(after).toHaveLength(before.length);
    expect(after.map((e) => ({ ...e, generation_id: gen.id }))).toEqual(before);
    expect(after.every((e) => e.generation_id === null)).toBe(true);
    expect(h.db.rows("provider_events").filter((e) => e.generation_id === gen.id)).toEqual([]);
    expect(await h.service.balance(ws)).toEqual(balanceBefore);
    expect(await h.service.monthToDateSpend(ws)).toEqual(monthBefore);
  });

  it("only touches the caller's workspace and reports foreign or unknown ids as not_found", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const mine = await finished(h);
    const theirs = await h.service.createGeneration({ request: { model: "fixture_image", prompt: "other" }, principal: { workspaceId: h.otherWorkspace.id, userId: "user-bob" } });
    await h.settle(theirs.id, h.otherWorkspace.id);
    const unknown = randomUUID();

    const result = await h.service.deleteGenerations(ws, [mine.id, theirs.id, unknown, "not-a-uuid", mine.id]);

    expect(result.deleted).toEqual([mine.id]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { id: theirs.id, reason: "not_found" },
        { id: unknown, reason: "not_found" },
        { id: "not-a-uuid", reason: "not_found" },
      ]),
    );
    expect(result.skipped).toHaveLength(3);
    expect(h.gen(theirs.id).state).toBe("succeeded");
    const theirAsset = h.db.rows("media_assets").find((a) => a.source_job_id === theirs.id);
    expect(theirAsset).toBeDefined();
    expect(h.storage.has("media", theirAsset!.object_path!)).toBe(true);
  });

  it("skips generations that are still running", async () => {
    const h = createHarness({ runningPolls: 5 });
    const ws = h.workspace.id;
    const running = await h.create();
    expect(h.gen(running.id).state).toBe("queued");

    const result = await h.service.deleteGenerations(ws, [running.id]);

    expect(result).toEqual({ deleted: [], skipped: [{ id: running.id, reason: "still running, cancel it first" }] });
    expect(h.db.find("generations", running.id)).toBeDefined();
  });

  it("deletes failed and cancelled generations too", async () => {
    const h = createHarness({ runningPolls: 5 });
    const ws = h.workspace.id;
    const job = await h.create();
    await h.service.cancelGeneration(job.id, ws);

    expect(await h.service.deleteGenerations(ws, [job.id])).toEqual({ deleted: [job.id], skipped: [] });
  });

  it("keeps a generated asset that another generation uses as an input by asset id", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const source = await finished(h);
    const consumer = await finished(h, { prompt: "edit it", medias: [{ role: "image_references", value: source.assetId }] });

    const result = await h.service.deleteGenerations(ws, [source.id]);

    expect(result.deleted).toEqual([source.id]);
    expect(h.asset(source.assetId)).toMatchObject({ source_job_id: null, status: "ready" });
    expect(h.storage.has("media", source.objectPath)).toBe(true);
    expect(h.storage.removeCalls).toEqual([]);
    expect(h.db.find("generations", consumer.id)).toBeDefined();
  });

  it("keeps the first output of a generation that another generation references by generation id", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const source = await finished(h);
    await finished(h, { prompt: "animate it", medias: [{ role: "image_references", value: source.id }] });

    await h.service.deleteGenerations(ws, [source.id]);

    expect(h.asset(source.assetId)).toMatchObject({ source_job_id: null });
    expect(h.storage.has("media", source.objectPath)).toBe(true);
  });

  it("deletes a referenced asset when the referencing generation is deleted in the same call", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const source = await finished(h);
    const consumer = await finished(h, { prompt: "edit it", medias: [{ role: "image_references", value: source.assetId }] });

    const result = await h.service.deleteGenerations(ws, [source.id, consumer.id]);

    expect(result.deleted).toEqual([source.id, consumer.id]);
    expect(h.db.find("media_assets", source.assetId)).toBeUndefined();
    expect(h.db.find("media_assets", consumer.assetId)).toBeUndefined();
    expect(h.storage.has("media", source.objectPath)).toBe(false);
  });

  it("never deletes uploaded or imported inputs of the deleted generation", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const upload = h.seedReadyAsset({ id: randomUUID() });
    const gen = await finished(h, { medias: [{ role: "image_references", value: upload.id }] });

    await h.service.deleteGenerations(ws, [gen.id]);

    expect(h.asset(upload.id).status).toBe("ready");
    expect(h.storage.has("media", upload.object_path!)).toBe(true);
  });

  it("does not fail when storage deletes fail or the object is already gone", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await finished(h);
    const b = await finished(h);
    h.storage.failRemove.add(a.objectPath);
    h.storage.buckets.get("media")!.delete(b.objectPath);

    const result = await h.service.deleteGenerations(ws, [a.id, b.id]);

    expect(result.deleted).toEqual([a.id, b.id]);
    expect(h.db.find("media_assets", a.assetId)).toBeUndefined();
    expect(h.db.find("media_assets", b.assetId)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses more than 100 ids", async () => {
    const h = createHarness();
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const error = await rejection(h.service.deleteGenerations(h.workspace.id, ids));
    expect(error.code).toBe("invalid_request");
  });
});

describe("deleteMedia", () => {
  it("deletes the asset row and its object; outputs that pointed at it keep the provider url", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const gen = await finished(h);

    const result = await h.service.deleteMedia(ws, [gen.assetId]);

    expect(result).toEqual({ deleted: [gen.assetId], skipped: [] });
    expect(h.db.find("media_assets", gen.assetId)).toBeUndefined();
    expect(h.storage.has("media", gen.objectPath)).toBe(false);
    const output = h.db.rows("generation_outputs").find((o) => o.generation_id === gen.id);
    expect(output).toMatchObject({ asset_id: null, provider_url: expect.any(String) });
    const view = await h.service.getGeneration(gen.id, { workspaceId: ws });
    expect(view.outputs[0]).toMatchObject({ asset_id: null, url: output!.provider_url });
  });

  it("deletes uploads from the uploads bucket", async () => {
    const h = createHarness();
    const ws = h.workspace.id;
    const target = await h.service.createUploadTarget(h.principal, { filename: "photo.png", contentType: "image/png" });
    h.storage.put("uploads", target.object_path, new Uint8Array([1, 2, 3]), "image/png");

    expect(await h.service.deleteMedia(ws, [target.asset_id])).toEqual({ deleted: [target.asset_id], skipped: [] });
    expect(h.storage.has("uploads", target.object_path)).toBe(false);
  });

  it("ignores assets of other workspaces and unknown ids", async () => {
    const h = createHarness();
    const theirs = h.seedReadyAsset({ id: randomUUID() }, h.otherWorkspace.id);
    const unknown = randomUUID();

    const result = await h.service.deleteMedia(h.workspace.id, [theirs.id, unknown]);

    expect(result).toEqual({ deleted: [], skipped: [{ id: theirs.id, reason: "not_found" }, { id: unknown, reason: "not_found" }] });
    expect(h.asset(theirs.id).status).toBe("ready");
    expect(h.storage.has("media", theirs.object_path!)).toBe(true);
  });

  it("logs a failing storage delete instead of failing the request", async () => {
    const h = createHarness();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const asset = h.seedReadyAsset({ id: randomUUID() });
    h.storage.failRemove.add(asset.object_path!);

    expect(await h.service.deleteMedia(h.workspace.id, [asset.id])).toEqual({ deleted: [asset.id], skipped: [] });
    expect(h.db.find("media_assets", asset.id)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
