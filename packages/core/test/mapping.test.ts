import { describe, expect, it } from "vitest";
import { buildProviderInput, effectiveRequest, extractOutputs, extractReportedCost, isFetchableUrl, prepareProviderRequest, resolveInputSpec, unmappedRoles } from "../src/catalog/mapping";
import type { InputMappingSpec, MediaRole, OutputMappingSpec } from "../src/catalog/types";
import type { NormalizedRequest, ResolvedMedia } from "../src/jobs/types";
import { falBinding, kieBinding, makeModel, makeRequest } from "./_helpers";

const model = makeModel();

function build(input: InputMappingSpec, request: NormalizedRequest = makeRequest(), medias: ResolvedMedia[] = []): Record<string, unknown> {
  return buildProviderInput(model, falBinding({ input }), request, medias);
}

function media(role: MediaRole, url: string, kind: ResolvedMedia["kind"] = "image"): ResolvedMedia {
  return { role, kind, url, source: `src:${url}` };
}

describe("buildProviderInput", () => {
  describe("prompt", () => {
    it("writes the prompt to `prompt` by default", () => {
      expect(build({})).toEqual({ prompt: "a red fox" });
    });

    it("renames the prompt field, including nested paths", () => {
      expect(build({ prompt: "text" })).toEqual({ text: "a red fox" });
      expect(build({ prompt: "input.text" })).toEqual({ input: { text: "a red fox" } });
    });

    it("drops the prompt when the spec says `prompt: null` or the request has none", () => {
      expect(build({ prompt: null })).toEqual({});
      expect(build({}, makeRequest({ prompt: undefined }))).toEqual({});
    });

    it("only sends negative_prompt when mapped", () => {
      const request = makeRequest({ negative_prompt: "blurry" });
      expect(build({}, request)).toEqual({ prompt: "a red fox" });
      expect(build({ negative_prompt: "negative_prompt" }, request)).toEqual({ prompt: "a red fox", negative_prompt: "blurry" });
      expect(build({ negative_prompt: null }, request)).toEqual({ prompt: "a red fox" });
    });
  });

  describe("aspect ratio", () => {
    const request = makeRequest({ aspect_ratio: "16:9" });

    it("writes to `aspect_ratio` by default", () => {
      expect(build({}, request)).toMatchObject({ aspect_ratio: "16:9" });
    });

    it("writes to a custom field and translates through the value map", () => {
      expect(build({ aspect_ratio: { field: "ratio", values: { "16:9": "landscape_16_9" } } }, request)).toMatchObject({ ratio: "landscape_16_9" });
      expect(build({ aspect_ratio: { field: "ratio", values: { "1:1": "square" } } }, request)).toMatchObject({ ratio: "16:9" });
      expect(build({ aspect_ratio: { field: "image.ratio" } }, request)).toMatchObject({ image: { ratio: "16:9" } });
    });

    it("translates into a size enum or dimension object via size_field", () => {
      const sizes = { "16:9": "landscape_16_9", "1:1": { width: 1024, height: 1024 } };
      expect(build({ aspect_ratio: { size_field: "image_size", sizes } }, request)).toMatchObject({ image_size: "landscape_16_9" });
      expect(build({ aspect_ratio: { size_field: "image_size", sizes } }, makeRequest({ aspect_ratio: "1:1" }))).toMatchObject({ image_size: { width: 1024, height: 1024 } });
    });

    it("omits the field for unknown sizes, `null`, or when the request has no ratio", () => {
      expect(build({ aspect_ratio: { size_field: "image_size", sizes: { "1:1": "square" } } }, request)).toEqual({ prompt: "a red fox" });
      expect(build({ aspect_ratio: null }, request)).toEqual({ prompt: "a red fox" });
      expect(build({ aspect_ratio: { field: "ratio" } }, makeRequest())).toEqual({ prompt: "a red fox" });
    });
  });

  describe("duration", () => {
    const request = makeRequest({ duration: 5 });

    it("writes a number to `duration` by default", () => {
      expect(build({}, request)).toMatchObject({ duration: 5 });
      expect(build({ duration: { field: "video_length" } }, request)).toMatchObject({ video_length: 5 });
    });

    it("supports number / string / seconds_suffix formats", () => {
      expect(build({ duration: { field: "duration", format: "number" } }, request)).toMatchObject({ duration: 5 });
      expect(build({ duration: { field: "duration", format: "string" } }, request)).toMatchObject({ duration: "5" });
      expect(build({ duration: { field: "duration", format: "seconds_suffix" } }, request)).toMatchObject({ duration: "5s" });
    });

    it("omits duration for `null` or when the request has none", () => {
      expect(build({ duration: null }, request)).toEqual({ prompt: "a red fox" });
      expect(build({ duration: { field: "duration" } }, makeRequest())).toEqual({ prompt: "a red fox" });
    });

    it("clamps to min/max before formatting", () => {
      expect(build({ duration: { field: "duration", min: 6 } }, request)).toMatchObject({ duration: 6 });
      expect(build({ duration: { field: "duration", max: 4, format: "string" } }, request)).toMatchObject({ duration: "4" });
      expect(build({ duration: { field: "duration", min: 1, max: 10 } }, request)).toMatchObject({ duration: 5 });
    });
  });

  describe("byMode overrides", () => {
    const spec: InputMappingSpec = {
      aspect_ratio: { field: "aspect_ratio" },
      duration: { field: "duration", format: "number" },
      roles: { start_image: "image_url", end_image: "end_image_url", image_references: "image_urls[]" },
      params: { resolution: "resolution" },
      constants: { output_format: "mp4" },
      byMode: {
        image: { aspect_ratio: null, constants: { aspect_ratio: "adaptive" } },
        reference: { duration: { field: "duration", format: "string", max: 10 }, params: { resolution: { field: "res" } } },
      },
    };
    const request = makeRequest({ aspect_ratio: "16:9", duration: 12, params: { resolution: "720p" } });

    it("leaves text mode untouched", () => {
      expect(resolveInputSpec(spec, "text")).toBe(spec);
      expect(build(spec, request)).toEqual({ output_format: "mp4", prompt: "a red fox", aspect_ratio: "16:9", duration: 12, resolution: "720p" });
    });

    it("drops the request ratio and merges constants for image mode", () => {
      expect(build(spec, request, [media("start_image", "https://m/s.png")])).toEqual({
        output_format: "mp4",
        aspect_ratio: "adaptive",
        prompt: "a red fox",
        duration: 12,
        image_url: "https://m/s.png",
        resolution: "720p",
      });
    });

    it("falls back from first_last to the image override unless first_last is given", () => {
      const medias = [media("start_image", "https://m/s.png"), media("end_image", "https://m/e.png")];
      expect(build(spec, request, medias)).toMatchObject({ aspect_ratio: "adaptive", image_url: "https://m/s.png", end_image_url: "https://m/e.png" });
      const explicit: InputMappingSpec = { ...spec, byMode: { ...spec.byMode, first_last: { aspect_ratio: { field: "ratio" } } } };
      const body = build(explicit, request, medias);
      expect(body).toMatchObject({ ratio: "16:9", output_format: "mp4" });
      expect(body).not.toHaveProperty("aspect_ratio");
    });

    it("replaces the duration spec and merges params for reference mode", () => {
      expect(build(spec, request, [media("image_references", "https://m/r.png")])).toEqual({
        output_format: "mp4",
        prompt: "a red fox",
        aspect_ratio: "16:9",
        duration: "10",
        image_urls: ["https://m/r.png"],
        res: "720p",
      });
    });

    it("returns the base spec when no override matches and never leaks byMode into the merged spec", () => {
      expect(resolveInputSpec({ prompt: "text" }, "image")).toEqual({ prompt: "text" });
      expect(resolveInputSpec(spec, "first_last")).toEqual(resolveInputSpec(spec, "image"));
      const merged = resolveInputSpec(spec, "image");
      expect(merged).not.toHaveProperty("byMode");
      expect(merged.constants).toEqual({ output_format: "mp4", aspect_ratio: "adaptive" });
      expect(merged.aspect_ratio).toBeNull();
      expect(merged.duration).toBe(spec.duration);
      expect(merged.roles).toBe(spec.roles);
      expect(spec.constants).toEqual({ output_format: "mp4" });
    });
  });

  describe("count", () => {
    const spec: InputMappingSpec = { count: { field: "num_images", max: 4 } };

    it("is only sent when count > 1", () => {
      expect(build(spec, makeRequest({ count: 1 }))).toEqual({ prompt: "a red fox" });
      expect(build(spec, makeRequest({ count: 3 }))).toMatchObject({ num_images: 3 });
    });

    it("is capped at the binding max", () => {
      expect(build(spec, makeRequest({ count: 9 }))).toMatchObject({ num_images: 4 });
      expect(build({ count: { field: "n" } }, makeRequest({ count: 9 }))).toMatchObject({ n: 9 });
    });

    it("is never sent when the spec has no count mapping", () => {
      expect(build({}, makeRequest({ count: 3 }))).toEqual({ prompt: "a red fox" });
      expect(build({ count: null }, makeRequest({ count: 3 }))).toEqual({ prompt: "a red fox" });
    });
  });

  describe("roles", () => {
    const spec: InputMappingSpec = {
      roles: { image: "image_url", image_references: "image_urls[]", video: "input.video_url", mask: "mask_url" },
    };
    const medias = [media("image", "https://m/1.png"), media("image", "https://m/2.png"), media("image_references", "https://m/r1.png"), media("image_references", "https://m/r2.png"), media("video", "https://m/v.mp4", "video")];

    it("uses the first item for singular fields and all items for [] fields", () => {
      expect(build(spec, makeRequest(), medias)).toEqual({
        prompt: "a red fox",
        image_url: "https://m/1.png",
        image_urls: ["https://m/r1.png", "https://m/r2.png"],
        input: { video_url: "https://m/v.mp4" },
      });
    });

    it("ignores roles without medias and medias without a mapping", () => {
      expect(build(spec, makeRequest(), [media("audio", "https://m/a.mp3", "audio")])).toEqual({ prompt: "a red fox" });
      expect(build({}, makeRequest(), medias)).toEqual({ prompt: "a red fox" });
    });

    it("a single reference still becomes an array for [] fields", () => {
      expect(build(spec, makeRequest(), [media("image_references", "https://m/r1.png")])).toMatchObject({ image_urls: ["https://m/r1.png"] });
    });
  });

  describe("params", () => {
    const request = makeRequest({ params: { steps: 20, resolution: "2K", style: "anime", debug: true, nested: { a: 1 } } });

    it("passes unknown params through under their own name by default", () => {
      expect(build({}, request)).toEqual({ prompt: "a red fox", steps: 20, resolution: "2K", style: "anime", debug: true, nested: { a: 1 } });
    });

    it("renames params with a string spec (nested paths allowed)", () => {
      expect(build({ params: { steps: "num_inference_steps", style: "settings.style" } }, request)).toMatchObject({
        num_inference_steps: 20,
        settings: { style: "anime" },
        resolution: "2K",
      });
    });

    it("translates values through a value map and leaves unmapped values alone", () => {
      const spec: InputMappingSpec = { params: { resolution: { field: "image_size", values: { "2K": "2048", "4K": "4096" } }, steps: { field: "steps", values: { 99: 1 } } } };
      expect(build(spec, request)).toMatchObject({ image_size: "2048", steps: 20 });
    });

    it("does not apply value maps to object values", () => {
      const spec: InputMappingSpec = { params: { nested: { field: "cfg", values: { "[object Object]": "oops" } } } };
      expect(build(spec, request)).toMatchObject({ cfg: { a: 1 } });
    });

    it("omits params flagged omit", () => {
      const result = build({ params: { debug: { field: "debug", omit: true } } }, request);
      expect(result).not.toHaveProperty("debug");
      expect(result).toMatchObject({ steps: 20 });
    });

    it("strictParams drops anything not listed", () => {
      expect(build({ strictParams: true, params: { steps: "steps", resolution: { field: "res" } } }, request)).toEqual({ prompt: "a red fox", steps: 20, res: "2K" });
      expect(build({ strictParams: true }, request)).toEqual({ prompt: "a red fox" });
    });

    it("skips undefined values", () => {
      expect(build({}, makeRequest({ params: { a: undefined, b: 1 } }))).toEqual({ prompt: "a red fox", b: 1 });
    });
  });

  describe("constants", () => {
    it("are merged first so request fields override them", () => {
      const spec: InputMappingSpec = { constants: { prompt: "default", sync_mode: true, output: { format: "png" } }, params: {} };
      expect(build(spec, makeRequest({ params: { output: { format: "jpeg" } } }))).toEqual({ prompt: "a red fox", sync_mode: true, output: { format: "jpeg" } });
    });

    it("support nested dot paths", () => {
      expect(build({ constants: { "options.safety": false, "options.tier": "pro" } })).toEqual({ prompt: "a red fox", options: { safety: false, tier: "pro" } });
    });
  });

  it("builds a complete nested body for a realistic mapping", () => {
    const spec: InputMappingSpec = {
      prompt: "input.prompt",
      aspect_ratio: { field: "input.aspect_ratio", values: { "9:16": "portrait" } },
      duration: { field: "input.duration", format: "seconds_suffix" },
      count: { field: "input.n", max: 2 },
      roles: { image: "input.image_url" },
      params: { audio: { field: "input.generate_audio" } },
      strictParams: true,
      constants: { "input.version": "v3" },
    };
    const request = makeRequest({ aspect_ratio: "9:16", duration: 8, count: 3, params: { audio: true, ignored: 1 } });
    expect(build(spec, request, [media("image", "https://m/start.png")])).toEqual({
      input: { version: "v3", prompt: "a red fox", aspect_ratio: "portrait", duration: "8s", n: 2, image_url: "https://m/start.png", generate_audio: true },
    });
  });
});

describe("extractOutputs", () => {
  it("reads images[].url and passes width/height/content_type through", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "images[]", kind: "image" }] };
    const payload = {
      images: [
        { url: "https://cdn/1.png", width: 1024, height: 768, content_type: "image/png" },
        { url: "https://cdn/2.png" },
        { width: 10, height: 10 },
        { url: "ftp://nope" },
        null,
        "https://cdn/3.png",
      ],
    };
    expect(extractOutputs(spec, payload)).toEqual([
      { kind: "image", url: "https://cdn/1.png", width: 1024, height: 768, content_type: "image/png" },
      { kind: "image", url: "https://cdn/2.png" },
      { kind: "image", url: "https://cdn/3.png" },
    ]);
  });

  it("reads a single video.url object and its duration", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "video", kind: "video" }] };
    expect(extractOutputs(spec, { video: { url: "https://cdn/v.mp4", content_type: "video/mp4", duration: "8" } })).toEqual([
      { kind: "video", url: "https://cdn/v.mp4", content_type: "video/mp4", duration_seconds: 8 },
    ]);
    expect(extractOutputs(spec, { video: { url: "https://cdn/v.mp4", duration: 4.5 } })).toEqual([{ kind: "video", url: "https://cdn/v.mp4", duration_seconds: 4.5 }]);
  });

  it("reads string arrays and skips non-URL strings", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "data.resultUrls[]", kind: "video" }] };
    const payload = { data: { resultUrls: ["https://cdn/a.mp4", "http://cdn/b.mp4", "not a url", "", "data:video/mp4;base64,AAAA"] } };
    expect(extractOutputs(spec, payload)).toEqual([
      { kind: "video", url: "https://cdn/a.mp4" },
      { kind: "video", url: "http://cdn/b.mp4" },
      { kind: "video", url: "data:video/mp4;base64,AAAA" },
    ]);
  });

  it("accepts data: URLs in objects", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "image", kind: "image" }] };
    expect(extractOutputs(spec, { image: { url: "data:image/png;base64,iVBORw0KGgo=" } })).toEqual([{ kind: "image", url: "data:image/png;base64,iVBORw0KGgo=" }]);
  });

  it("honours custom url/width/height/content_type paths", () => {
    const spec: OutputMappingSpec = {
      outputs: [{ path: "results[]", kind: "image", url_path: "file.uri", width_path: "meta.w", height_path: "meta.h", content_type_path: "file.mime" }],
    };
    const payload = { results: [{ file: { uri: "https://cdn/x.jpg", mime: "image/jpeg" }, meta: { w: "512", h: 256 }, url: "https://ignored" }] };
    expect(extractOutputs(spec, payload)).toEqual([{ kind: "image", url: "https://cdn/x.jpg", content_type: "image/jpeg", width: 512, height: 256 }]);
  });

  it("attaches seed_path to every output, for both string and object items", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "images[]", kind: "image" }, { path: "urls[]", kind: "image" }], seed_path: "meta.seed" };
    const payload = { images: [{ url: "https://cdn/1.png" }], urls: ["https://cdn/2.png"], meta: { seed: "1234" } };
    expect(extractOutputs(spec, payload)).toEqual([
      { kind: "image", url: "https://cdn/1.png", seed: 1234 },
      { kind: "image", url: "https://cdn/2.png", seed: 1234 },
    ]);
  });

  it("leaves seed undefined when seed_path is missing or non-numeric", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "images[]", kind: "image" }], seed_path: "seed" };
    expect(extractOutputs(spec, { images: [{ url: "https://cdn/1.png" }] })[0]?.seed).toBeUndefined();
    expect(extractOutputs(spec, { images: [{ url: "https://cdn/1.png" }], seed: "abc" })[0]?.seed).toBeUndefined();
  });

  it("ignores non-numeric width/height", () => {
    const spec: OutputMappingSpec = { outputs: [{ path: "image", kind: "image" }] };
    expect(extractOutputs(spec, { image: { url: "https://cdn/1.png", width: "wide", height: null } })).toEqual([{ kind: "image", url: "https://cdn/1.png" }]);
  });

  it("combines multiple rules in order and returns [] for empty payloads", () => {
    const spec: OutputMappingSpec = {
      outputs: [
        { path: "video", kind: "video" },
        { path: "thumbnails[]", kind: "image" },
      ],
    };
    expect(extractOutputs(spec, { video: { url: "https://cdn/v.mp4" }, thumbnails: ["https://cdn/t.png"] })).toEqual([
      { kind: "video", url: "https://cdn/v.mp4" },
      { kind: "image", url: "https://cdn/t.png" },
    ]);
    expect(extractOutputs(spec, {})).toEqual([]);
    expect(extractOutputs(spec, null)).toEqual([]);
    expect(extractOutputs(spec, "https://cdn/v.mp4")).toEqual([]);
  });
});

describe("effectiveRequest", () => {
  const videoModel = makeModel({ id: "fixture_video", output_type: "video", parameters: [{ name: "resolution", type: "string", required: false, description: "tier", options: ["720p", "1080p"], default: "720p" }, { name: "seed", type: "integer", required: false, description: "seed" }] });

  it("is exact and adjustment-free when the binding serves the request as asked", () => {
    const result = effectiveRequest(videoModel, falBinding({ input: { duration: { field: "duration" }, count: { field: "n" } } }), makeRequest({ duration: 8, count: 2 }));
    expect(result).toMatchObject({ exact: true, adjustments: [], mode: "text" });
    expect(result.request).toMatchObject({ duration: 8, count: 2 });
  });

  it("reports clamps, fixed clip lengths, single-output endpoints and pinned tiers", () => {
    const clamp = effectiveRequest(videoModel, falBinding({ input: { duration: { field: "duration", min: 5 } } }), makeRequest({ duration: 4 }));
    expect(clamp).toMatchObject({ exact: false, request: { duration: 5 }, adjustments: [{ field: "duration", from: 4, to: 5, reason: "fal fal-ai/fixture supports at least 5 s" }] });

    const fixed = effectiveRequest(videoModel, kieBinding({ input: { duration: null }, fixedDuration: 8 }), makeRequest({ duration: 4 }));
    expect(fixed).toMatchObject({ exact: false, request: { duration: 8 }, adjustments: [{ field: "duration", from: 4, to: 8 }] });
    expect(effectiveRequest(videoModel, kieBinding({ input: { duration: null }, fixedDuration: 8 }), makeRequest({ duration: 8 })).exact).toBe(true);

    const single = effectiveRequest(videoModel, kieBinding({ input: { count: null } }), makeRequest({ count: 3 }));
    expect(single).toMatchObject({ exact: false, request: { count: 1 }, adjustments: [{ field: "count", from: 3, to: 1 }] });
    const capped = effectiveRequest(videoModel, falBinding({ input: { count: { field: "n", max: 2 } } }), makeRequest({ count: 3 }));
    expect(capped).toMatchObject({ request: { count: 2 }, adjustments: [{ field: "count", from: 3, to: 2 }] });

    const pinned = effectiveRequest(videoModel, falBinding({ pinnedParams: { resolution: "1080p" }, input: { params: { resolution: { field: "resolution", omit: true } } } }), makeRequest({ params: { resolution: "720p" } }));
    expect(pinned).toMatchObject({ exact: false, request: { params: { resolution: "1080p" } }, adjustments: [{ field: "params.resolution", from: "720p", to: "1080p" }] });
  });

  it("drops parameters the endpoint lacks and reports explicit values only", () => {
    const binding = falBinding({ input: { strictParams: true, params: { seed: { field: "seed", omit: true } } } });
    const defaulted = effectiveRequest(videoModel, binding, makeRequest({ params: { resolution: "720p" } }));
    expect(defaulted.request.params).toEqual({});
    expect(defaulted.adjustments).toEqual([]);
    const explicit = effectiveRequest(videoModel, binding, makeRequest({ params: { resolution: "1080p", seed: 3 } }));
    expect(explicit.adjustments.map((a) => a.field)).toEqual(["params.resolution", "params.seed"]);
    expect(explicit.exact).toBe(true);
  });

  it("snaps size presets that only approximate the ratio and prices the rendered ratio", () => {
    const binding = falBinding({ input: { aspect_ratio: { size_field: "image_size", sizes: { "4:3": "landscape_4_3", "3:2": "landscape_4_3" }, rendered: { "3:2": "4:3" } } } });
    const result = effectiveRequest(model, binding, makeRequest({ aspect_ratio: "3:2" }));
    expect(result).toMatchObject({ exact: false, request: { aspect_ratio: "4:3" }, adjustments: [{ field: "aspect_ratio", from: "3:2", to: "4:3" }] });
    const boxes = falBinding({ input: { aspect_ratio: { size_field: "image_size", sizes: { "16:9": { width: 1536, height: 1024 } } } } });
    expect(effectiveRequest(model, boxes, makeRequest({ aspect_ratio: "16:9" })).adjustments).toEqual([expect.objectContaining({ to: "3:2" })]);
  });

  it("drops deliberately ignored roles with an adjustment and finds unmapped ones", () => {
    const binding = falBinding({ input: { roles: { start_image: "image_url" } }, ignoredRoles: ["image_references"] });
    const request = makeRequest({ medias: [{ role: "start_image", value: "s" }, { role: "image_references", value: "r" }] });
    const result = effectiveRequest(model, binding, request);
    expect(result.request.medias).toEqual([{ role: "start_image", value: "s" }]);
    expect(result.adjustments).toEqual([expect.objectContaining({ field: "medias.image_references", from: 1, to: 0 })]);
    expect(unmappedRoles(binding, request.medias)).toEqual([]);
    expect(unmappedRoles(falBinding({ input: { roles: { start_image: "image_url" } } }), request.medias)).toEqual(["image_references"]);
  });

  it("prepares the endpoint, body and adjustments in one call", () => {
    const binding = falBinding({ endpointByMode: { image: "fal-ai/fixture/i2v" }, input: { roles: { start_image: "image_url" }, count: null } });
    const prepared = prepareProviderRequest({ model, binding, request: makeRequest({ count: 2 }), medias: [media("start_image", "https://m/s.png")] });
    expect(prepared).toMatchObject({ endpoint: "fal-ai/fixture/i2v", mode: "image", body: { prompt: "a red fox", image_url: "https://m/s.png" }, request: { count: 1 } });
    expect(prepared.adjustments).toHaveLength(1);
  });
});

describe("isFetchableUrl", () => {
  it("accepts http(s) and data: URLs only", () => {
    expect(isFetchableUrl("https://cdn/x.png")).toBe(true);
    expect(isFetchableUrl("http://cdn/x.png")).toBe(true);
    expect(isFetchableUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isFetchableUrl("ftp://cdn/x.png")).toBe(false);
    expect(isFetchableUrl("/relative.png")).toBe(false);
  });
});

describe("extractReportedCost", () => {
  it("reads numeric costs (numbers or numeric strings)", () => {
    expect(extractReportedCost({ outputs: [], cost_path: "usage.cost" }, { usage: { cost: 0.0325 } })).toBe(0.0325);
    expect(extractReportedCost({ outputs: [], cost_path: "creditsConsumed" }, { creditsConsumed: "40" })).toBe(40);
  });

  it("returns undefined when there is no cost_path, no value, or a non-numeric value", () => {
    expect(extractReportedCost({ outputs: [] }, { usage: { cost: 1 } })).toBeUndefined();
    expect(extractReportedCost({ outputs: [], cost_path: "usage.cost" }, {})).toBeUndefined();
    expect(extractReportedCost({ outputs: [], cost_path: "usage.cost" }, { usage: { cost: "free" } })).toBeUndefined();
    expect(extractReportedCost({ outputs: [], cost_path: "usage.cost" }, { usage: { cost: "" } })).toBeUndefined();
  });
});
