import { describe, expect, it } from "vitest";
import { createMockProvider, MockProvider, mockArtworkSvg, mockBindingFor, withMockBindings, MOCK_PROVIDER_NOTE } from "../src/providers/mock/index";
import { FalProvider } from "../src/providers/fal/index";
import { SEED_MODELS } from "../src/catalog/models/index";
import { normalizeRequest } from "../src/catalog/normalize";
import type { MediaRole, ModelDefinition } from "../src/catalog/types";
import type { ResolvedMedia } from "../src/jobs/types";
import type { SubmitInput } from "../src/providers/types";
import { ProviderRouter } from "../src/router/index";
import { estimateCost } from "../src/cost/index";
import { decodeDataUrl } from "../src/util/data-url";
import { createFakeFetch, makeModel, makeRequest, mockBinding } from "./_helpers";

const imageModel = makeModel();
const videoModel = makeModel({ id: "fixture_video", output_type: "video", capabilities: ["text-to-video"], durations: [5, 10] });
const binding = mockBinding({ input: { count: { field: "n" } } });

function submitInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return { model: imageModel, binding, request: makeRequest(), medias: [], ...overrides };
}

function svgOf(url: string): string {
  const decoded = decodeDataUrl(url);
  if (!decoded) throw new Error(`not a data url: ${url.slice(0, 40)}`);
  expect(decoded.contentType).toBe("image/svg+xml");
  return new TextDecoder().decode(decoded.bytes);
}

describe("MockProvider (simulated mode, the offline demo)", () => {
  const T0 = 1_700_000_000_000;

  it("is always configured, identifies as mock and encodes the job in a stateless id", async () => {
    const provider = createMockProvider({ now: () => T0, delayMs: 5_000 });
    expect(provider.id).toBe("mock");
    expect(provider.isConfigured()).toBe(true);
    const { ref, providerInput, adjustments } = await provider.submit(submitInput({ request: makeRequest({ count: 2 }) }));
    expect(ref).toEqual({ provider: "mock", providerJobId: expect.stringMatching(/^mock_[A-Za-z0-9_-]+$/), endpoint: "mock/fixture" });
    expect(providerInput).toEqual({ prompt: "a red fox", n: 2 });
    expect(adjustments).toEqual([]);
    expect(provider.jobs.size).toBe(0);
  });

  it("goes queued -> running -> succeeded on the injected clock, and any instance can answer a poll", async () => {
    let clock = T0;
    const submitter = createMockProvider({ now: () => clock, delayMs: 5_000 });
    const { ref } = await submitter.submit(submitInput());
    // A different instance (another serverless instance, or a rebuilt router) sees the same job.
    const poller = createMockProvider({ now: () => clock });
    expect(await poller.getStatus(ref)).toEqual({ state: "queued", queuePosition: 1 });
    clock = T0 + 1_000;
    expect(await poller.getStatus(ref)).toEqual({ state: "running", progress: 20 });
    clock = T0 + 4_999;
    expect(await poller.getStatus(ref)).toEqual({ state: "running", progress: 99 });
    clock = T0 + 5_000;
    const done = await poller.getStatus(ref);
    expect(done.state).toBe("succeeded");
    expect(done.costUsd).toBe(0);
    expect(done.outputs).toHaveLength(1);
    clock = T0 + 60_000;
    expect((await poller.getStatus(ref)).state).toBe("succeeded");
  });

  it("picks a deterministic delay between 3 and 8 s by default", async () => {
    const at = (provider: MockProvider) => provider.submit(submitInput({ request: makeRequest({ prompt: "a lighthouse at dusk" }) }));
    const provider = createMockProvider({ now: () => T0 });
    const a = await at(provider);
    const b = await at(provider);
    expect(a.ref.providerJobId).toBe(b.ref.providerJobId);
    let firstSuccess = 0;
    for (let ms = 0; ms <= 9_000; ms += 250) {
      const status = await createMockProvider({ now: () => T0 + ms }).getStatus(a.ref);
      if (status.state === "succeeded") {
        firstSuccess = ms;
        break;
      }
    }
    expect(firstSuccess).toBeGreaterThanOrEqual(3_000);
    expect(firstSuccess).toBeLessThanOrEqual(8_250);
  });

  it("returns `count` generated SVG images at the requested aspect ratio, seeded by the prompt", async () => {
    const provider = createMockProvider({ now: () => T0, delayMs: 0 });
    const { ref } = await provider.submit(submitInput({ request: makeRequest({ count: 3, aspect_ratio: "16:9" }) }));
    const { outputs } = await provider.getStatus(ref);
    expect(outputs).toHaveLength(3);
    for (const output of outputs ?? []) {
      expect(output).toMatchObject({ kind: "image", content_type: "image/svg+xml", width: 1024, height: 576 });
      expect(output.url).toMatch(/^data:image\/svg\+xml;base64,/);
      const svg = svgOf(output.url);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1024" height="576" viewBox="0 0 1024 576">/);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain(">demo</text>");
      expect(svg).not.toContain("NaN");
    }
    expect(new Set(outputs?.map((o) => o.url)).size).toBe(3);

    // Same prompt, same pictures; another prompt, other pictures.
    const again = await provider.getStatus((await provider.submit(submitInput({ request: makeRequest({ count: 3, aspect_ratio: "16:9" }) }))).ref);
    expect(again.outputs?.map((o) => o.url)).toEqual(outputs?.map((o) => o.url));
    const other = await provider.getStatus((await provider.submit(submitInput({ request: makeRequest({ prompt: "a blue whale", aspect_ratio: "16:9" }) }))).ref);
    expect(other.outputs?.[0]?.url).not.toBe(outputs?.[0]?.url);

    const portrait = await provider.getStatus((await provider.submit(submitInput({ request: makeRequest({ aspect_ratio: "9:16" }) }))).ref);
    expect(portrait.outputs?.[0]).toMatchObject({ width: 576, height: 1024 });
  });

  it("uses the output resolver (e.g. local sample videos) and falls back to the placeholder when it returns nothing", async () => {
    const seen: Array<{ model: string; index: number; aspectRatio?: string; durationSeconds?: number; prompt?: string }> = [];
    const provider = createMockProvider({
      now: () => T0,
      delayMs: 0,
      resolveOutput: (request, index) => {
        seen.push({ model: request.model, index, aspectRatio: request.aspectRatio, durationSeconds: request.durationSeconds, prompt: request.prompt });
        return request.outputType === "video" ? { url: `/demo/clip-${request.seed % 3}.mp4`, contentType: "video/mp4", width: 1280, height: 720, durationSeconds: request.durationSeconds } : undefined;
      },
    });
    const video = await provider.submit(submitInput({ model: videoModel, request: makeRequest({ duration: 10, aspect_ratio: "16:9" }) }));
    const videoStatus = await provider.getStatus(video.ref);
    expect(videoStatus.outputs).toEqual([{ kind: "video", url: expect.stringMatching(/^\/demo\/clip-[0-2]\.mp4$/), content_type: "video/mp4", width: 1280, height: 720, duration_seconds: 10, seed: expect.any(Number) }]);
    expect(seen[0]).toEqual({ model: "fixture_video", index: 0, aspectRatio: "16:9", durationSeconds: 10, prompt: "a red fox" });

    const image = await provider.getStatus((await provider.submit(submitInput())).ref);
    expect(image.outputs?.[0]?.url).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("returns an image-typed placeholder (with a play button) for video without a resolver, or the configured placeholder", async () => {
    const provider = createMockProvider({ now: () => T0, delayMs: 0 });
    const status = await provider.getStatus((await provider.submit(submitInput({ model: videoModel, request: makeRequest({ duration: 10 }) }))).ref);
    expect(status.outputs?.[0]).toMatchObject({ kind: "image", content_type: "image/svg+xml", duration_seconds: 10 });
    const svg = svgOf(status.outputs?.[0]?.url ?? "");
    expect(svg).toContain("<animate");

    const hosted = createMockProvider({ now: () => T0, delayMs: 0, placeholders: { video: "https://samples.test/clip.mp4" } });
    const hostedStatus = await hosted.getStatus((await hosted.submit(submitInput({ model: videoModel, request: makeRequest({ duration: 5 }) }))).ref);
    expect(hostedStatus.outputs).toEqual([{ kind: "video", url: "https://samples.test/clip.mp4", seed: expect.any(Number), duration_seconds: 5 }]);
  });

  it("fails jobs whose prompt contains the fail marker once the delay has passed", async () => {
    let clock = T0;
    const provider = createMockProvider({ now: () => clock, delayMs: 2_000, failMarker: "BOOM" });
    const { ref } = await provider.submit(submitInput({ request: makeRequest({ prompt: "BOOM goes the fox" }) }));
    clock = T0 + 1_000;
    expect((await provider.getStatus(ref)).state).toBe("running");
    clock = T0 + 2_000;
    expect(await provider.getStatus(ref)).toEqual({ state: "failed", error: { code: "mock_failure", message: "prompt contained the fail marker", retryable: false } });
  });

  it("reports unknown, foreign or tampered job ids as not found and never throws", async () => {
    const provider = createMockProvider({ now: () => T0 });
    for (const id of ["nope", "mock_1_abc", "mock_!!!", "mock_eyJ2IjoyfQ"]) {
      expect(await provider.getStatus({ provider: "mock", providerJobId: id, endpoint: "mock/fixture" }), id).toEqual({ state: "failed", error: { code: "not_found", message: "unknown mock job" } });
    }
    expect(await provider.cancel({ provider: "mock", providerJobId: "nope", endpoint: "mock/fixture" })).toBe(false);
    const { ref } = await provider.submit(submitInput());
    expect(await provider.cancel(ref)).toBe(true);
  });

  it("parses hand-posted webhooks without trusting them and never throws on garbage", async () => {
    const provider = createMockProvider();
    const event = await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ providerJobId: "mock_x", state: "failed", payload: { x: 1 } }) });
    expect(event).toEqual({ provider: "mock", providerJobId: "mock_x", state: "failed", payload: { x: 1 }, verified: false, payloadAuthenticated: false, raw: { providerJobId: "mock_x", state: "failed", payload: { x: 1 } } });
    for (const rawBody of ["not json", "[1,2]", "null", "42"]) {
      expect(await provider.parseWebhook({ headers: {}, rawBody }), rawBody).toMatchObject({ provider: "mock", providerJobId: "", state: "failed", error: { code: "bad_payload" }, verified: false });
    }
    expect((await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ providerJobId: "m", state: "exploded" }) })).state).toBe("succeeded");
    expect((await createMockProvider({ trustWebhooks: true }).parseWebhook({ headers: {}, rawBody: "{}" })).verified).toBe(true);
  });
});

describe("MockProvider (step mode for host test suites)", () => {
  it("submits jobs with unique ids and a mapped provider input, kept in memory", async () => {
    const provider = new MockProvider({ runningPolls: 1 });
    const a = await provider.submit(submitInput({ request: makeRequest({ count: 2 }) }));
    const b = await provider.submit(submitInput());
    expect(a.ref).toEqual({ provider: "mock", providerJobId: expect.stringMatching(/^mock_1_[a-z0-9]+$/), endpoint: "mock/fixture" });
    expect(b.ref.providerJobId).toMatch(/^mock_2_/);
    expect(a.ref.providerJobId).not.toBe(b.ref.providerJobId);
    expect(a.providerInput).toEqual({ prompt: "a red fox", n: 2 });
    expect(provider.jobs.size).toBe(2);
  });

  it("stays running for runningPolls polls, then succeeds with `count` hosted placeholder outputs", async () => {
    const provider = new MockProvider({ runningPolls: 2 });
    const { ref } = await provider.submit(submitInput({ request: makeRequest({ count: 3 }) }));

    expect(await provider.getStatus(ref)).toEqual({ state: "running", progress: 50 });
    expect(await provider.getStatus(ref)).toEqual({ state: "running", progress: 99 });

    const done = await provider.getStatus(ref);
    expect(done.state).toBe("succeeded");
    expect(done.outputs).toEqual([
      { kind: "image", url: "https://placehold.co/1024x1024.png?model=fixture_image&i=0", content_type: "image/png", width: 1024, height: 1024 },
      { kind: "image", url: "https://placehold.co/1024x1024.png?model=fixture_image&i=1", content_type: "image/png", width: 1024, height: 1024 },
      { kind: "image", url: "https://placehold.co/1024x1024.png?model=fixture_image&i=2", content_type: "image/png", width: 1024, height: 1024 },
    ]);
    expect((await provider.getStatus(ref)).state).toBe("succeeded");
  });

  it("produces typed outputs per output_type (video carries the requested duration)", async () => {
    const provider = new MockProvider({ runningPolls: 0 });
    const video = await provider.submit(submitInput({ model: videoModel, request: makeRequest({ duration: 10 }) }));
    expect((await provider.getStatus(video.ref)).outputs).toEqual([{ kind: "video", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4?model=fixture_video&i=0", content_type: "video/mp4", duration_seconds: 10 }]);

    const noDuration = await provider.submit(submitInput({ model: videoModel }));
    expect((await provider.getStatus(noDuration.ref)).outputs?.[0]?.duration_seconds).toBe(5);

    const audio = await provider.submit(submitInput({ model: makeModel({ id: "fixture_audio", output_type: "audio" }) }));
    expect((await provider.getStatus(audio.ref)).outputs).toEqual([{ kind: "audio", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3?model=fixture_audio&i=0", content_type: "audio/mpeg" }]);

    const threeD = await provider.submit(submitInput({ model: makeModel({ id: "fixture_3d", output_type: "3d" }) }));
    expect((await provider.getStatus(threeD.ref)).outputs).toEqual([{ kind: "model", url: "https://modelviewer.dev/shared-assets/models/Astronaut.glb?model=fixture_3d&i=0", content_type: "model/gltf-binary" }]);
  });

  it("uses configured placeholder urls", async () => {
    const provider = new MockProvider({ runningPolls: 0, placeholders: { image: "https://placeholder.test/img.png", model: "https://placeholder.test/m.glb" } });
    const image = await provider.submit(submitInput({ request: makeRequest({ count: 2 }) }));
    expect((await provider.getStatus(image.ref)).outputs?.map((o) => o.url)).toEqual(["https://placeholder.test/img.png", "https://placeholder.test/img.png"]);
    const threeD = await provider.submit(submitInput({ model: makeModel({ id: "fixture_3d", output_type: "3d" }) }));
    expect((await provider.getStatus(threeD.ref)).outputs?.[0]?.url).toBe("https://placeholder.test/m.glb");
  });

  it("fails jobs whose prompt contains the fail marker (after the running phase)", async () => {
    const provider = new MockProvider({ runningPolls: 1 });
    const { ref } = await provider.submit(submitInput({ request: makeRequest({ prompt: "a fox [fail] please" }) }));
    expect((await provider.getStatus(ref)).state).toBe("running");
    const failed = await provider.getStatus(ref);
    expect(failed.state).toBe("failed");
    expect(failed.error).toEqual({ code: "mock_failure", message: "prompt contained the fail marker" });
    expect(failed.outputs).toBeUndefined();
  });

  it("cancel removes the job; later polls report not_found", async () => {
    const provider = new MockProvider({ runningPolls: 1 });
    const { ref } = await provider.submit(submitInput());
    expect(await provider.cancel(ref)).toBe(true);
    expect(provider.jobs.size).toBe(0);
    expect(await provider.cancel(ref)).toBe(false);
    expect(await provider.getStatus(ref)).toEqual({ state: "failed", error: { code: "not_found", message: "unknown mock job" } });
  });

  it("records createdAt via the injected clock", async () => {
    const provider = new MockProvider({ runningPolls: 1, now: () => 12345 });
    const { ref } = await provider.submit(submitInput());
    expect(provider.jobs.get(ref.providerJobId)?.createdAt).toBe(12345);
  });

  it("trusts parseable webhooks (it is a test double) but not garbage", async () => {
    const provider = new MockProvider({ runningPolls: 1 });
    const event = await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ providerJobId: "mock_1_abc", state: "failed", payload: { x: 1 } }) });
    expect(event).toEqual({ provider: "mock", providerJobId: "mock_1_abc", state: "failed", payload: { x: 1 }, verified: true, payloadAuthenticated: true, raw: { providerJobId: "mock_1_abc", state: "failed", payload: { x: 1 } } });
    expect(await provider.parseWebhook({ headers: {}, rawBody: "" })).toMatchObject({ provider: "mock", providerJobId: "", state: "succeeded", verified: true });
    expect(await provider.parseWebhook({ headers: {}, rawBody: "{oops" })).toMatchObject({ state: "failed", verified: false });
  });

  it("upload echoes the source url or fabricates a mock url", async () => {
    const provider = new MockProvider({ runningPolls: 1 });
    expect(await provider.upload({ filename: "a.png", contentType: "image/png", sourceUrl: "https://origin.test/a.png" })).toEqual({ url: "https://origin.test/a.png" });
    expect(await provider.upload({ filename: "my file.png", contentType: "image/png", bytes: new Uint8Array([1]) })).toEqual({ url: "https://placehold.co/512x512.png?upload=my%20file.png" });
  });
});

describe("mockArtworkSvg", () => {
  it("is deterministic per seed, sized to the request and hides the label on request", () => {
    const a = mockArtworkSvg({ seed: 42, width: 1024, height: 768 });
    expect(mockArtworkSvg({ seed: 42, width: 1024, height: 768 })).toBe(a);
    expect(mockArtworkSvg({ seed: 43, width: 1024, height: 768 })).not.toBe(a);
    expect(a).toContain('viewBox="0 0 1024 768"');
    expect(a).not.toMatch(/NaN|undefined|hsl\(/);
    expect(mockArtworkSvg({ seed: 42, width: 512, height: 512, label: "" })).not.toContain("<text");
    expect(mockArtworkSvg({ seed: 1, width: 64, height: 64, label: "<b>&" })).toContain("&lt;b&gt;&amp;");
    expect(mockArtworkSvg({ seed: 1, width: 64, height: 64, video: true })).toContain("<animate");
  });
});

describe("withMockBindings", () => {
  const MODES_MEDIA: Record<string, MediaRole[]> = { text: [], image: ["start_image"], first_last: ["start_image", "end_image"] };

  function mediaFor(model: ModelDefinition, roles: MediaRole[]): ResolvedMedia[] {
    return roles.map((role) => {
      const kind = model.medias.find((slot) => slot.role === role)?.kind ?? "image";
      return { role, kind, url: `https://example.test/${role}`, source: `asset_${role}` };
    });
  }

  it("adds exactly one zero-cost, last-resort mock binding per model and leaves models that have one alone", () => {
    const models = withMockBindings(SEED_MODELS);
    expect(models).toHaveLength(SEED_MODELS.length);
    for (const [i, model] of models.entries()) {
      const mocks = model.bindings.filter((b) => b.provider === "mock");
      expect(mocks, model.id).toHaveLength(1);
      expect(mocks[0]).toMatchObject({ endpoint: `mock/${model.id}`, lastResort: true, pricing: { unit: "generation", usd: 0, notes: MOCK_PROVIDER_NOTE } });
      expect(SEED_MODELS[i]?.bindings.some((b) => b.provider === "mock")).toBe(false);
    }
    expect(withMockBindings(models)).toEqual(models);
    const already = makeModel({ bindings: [mockBinding()] });
    expect(withMockBindings([already])[0]).toBe(already);
  });

  it("routes every catalog model to the mock when it is the only provider, in every mode the model declares, at zero cost", async () => {
    let clock = 1_000;
    const mock = createMockProvider({ now: () => clock, delayMs: 3_000 });
    const router = new ProviderRouter([mock]);
    let routed = 0;
    for (const model of withMockBindings(SEED_MODELS)) {
      const roleSets: MediaRole[][] = [];
      const declared = new Set(model.medias.map((slot) => slot.role));
      const required = model.medias.filter((slot) => slot.required).map((slot) => slot.role);
      for (const roles of Object.values(MODES_MEDIA)) if (roles.every((role) => declared.has(role))) roleSets.push([...new Set([...roles, ...required])]);
      const others = [...declared].filter((role) => role !== "start_image" && role !== "end_image");
      if (others.length > 0) roleSets.push([...new Set([...others, ...required])]);
      for (const roles of roleSets) {
        const label = `${model.id} [${roles.join(",") || "text"}]`;
        const request = normalizeRequest(model, {
          model: model.id,
          prompt: "a quiet harbour at dawn",
          count: model.max_count ?? 4,
          aspect_ratio: model.aspect_ratios.at(-1),
          medias: roles.map((role) => ({ role, value: `asset_${role}` })),
        });
        const decision = router.route(model, { request });
        expect(decision.provider.id, label).toBe("mock");
        expect(estimateCost(model, decision.binding, request), label).toMatchObject({ usd: 0, provider: "mock" });
        const medias = mediaFor(model, roles);
        const submitted = await decision.provider.submit({ model, binding: decision.binding, request, medias });
        expect(submitted.adjustments, label).toEqual([]);
        clock += 3_000;
        const status = await decision.provider.getStatus(submitted.ref, decision.binding);
        expect(status.state, label).toBe("succeeded");
        expect(status.outputs, label).toHaveLength(request.count);
        routed += 1;
      }
    }
    expect(routed).toBeGreaterThan(SEED_MODELS.length);
  });

  it("never routes to the mock while a paid provider can serve the request, unless asked to", () => {
    const fal = new FalProvider({ apiKey: "fal-key", fetch: createFakeFetch().fetch });
    const router = new ProviderRouter([fal, createMockProvider()]);
    const model = withMockBindings(SEED_MODELS).find((m) => m.id === "z_image_turbo");
    if (!model) throw new Error("z_image_turbo missing");
    const request = normalizeRequest(model, { model: model.id, prompt: "x" });
    expect(router.candidates(model, { request }).map((c) => c.provider.id)).toEqual(["fal"]);
    expect(router.route(model, { request, provider: "mock" }).binding.endpoint).toBe("mock/z_image_turbo");
    // With no paid binding left for the request, the mock is the last resort.
    expect(new ProviderRouter([createMockProvider()]).route(model, { request }).provider.id).toBe("mock");
  });

  it("mirrors the model limits in the synthesized binding", () => {
    const veo = SEED_MODELS.find((m) => m.id === "veo_3_1");
    if (!veo) throw new Error("veo_3_1 missing");
    const binding = mockBindingFor(veo);
    expect(binding.input.roles).toEqual({ start_image: "start_image[]", end_image: "end_image[]", image_references: "image_references[]" });
    expect(binding.input.duration).toEqual({ field: "duration" });
    expect(binding.input.count).toBeNull();
    expect(mockBindingFor(makeModel({ max_count: 4 })).input.count).toEqual({ field: "count", max: 4 });
  });
});
