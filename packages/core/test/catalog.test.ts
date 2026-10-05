import { describe, expect, it } from "vitest";
import { buildProviderInput, extractOutputs, prepareProviderRequest, resolveEndpoint, resolveEndpointMode, resolveInputSpec } from "../src/catalog/mapping";
import { IMAGE_MODELS, SEED_MODELS, SEED_MODEL_COUNT, UTILITY_MODELS, VIDEO_MODELS } from "../src/catalog/models/index";
import { normalizeRequest } from "../src/catalog/normalize";
import { ProviderRouter, servesRequest } from "../src/router/index";
import { HiggsfieldProvider } from "../src/providers/higgsfield/index";
import { estimateCost } from "../src/cost/index";
import { getPath } from "../src/util/path";
import type { EndpointMode, MediaRole, ModelDefinition, ProviderBinding, ProviderId } from "../src/catalog/types";
import type { NormalizedRequest, ResolvedMedia } from "../src/jobs/types";

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DEFAULT_MAX_COUNT = 4;

function model(id: string): ModelDefinition {
  const found = SEED_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`model ${id} missing from seed catalog`);
  return found;
}

function binding(m: ModelDefinition, provider: ProviderId, endpoint?: string): ProviderBinding {
  const found = m.bindings.find((b) => b.provider === provider && (endpoint === undefined || b.endpoint === endpoint));
  if (!found) throw new Error(`${m.id} has no ${provider} binding${endpoint ? ` for ${endpoint}` : ""}`);
  return found;
}

function media(role: MediaRole, url: string): ResolvedMedia {
  const kind = role.startsWith("video") ? "video" : role.startsWith("audio") ? "audio" : "image";
  return { role, kind, url, source: url };
}

function request(partial: Partial<NormalizedRequest> & { model: string }): NormalizedRequest {
  return { count: 1, medias: [], params: {}, adjustments: [], ...partial };
}

const ALL_MODES: readonly EndpointMode[] = ["text", "image", "first_last", "reference"];
/** Request fields (besides parameters) a price modifier may key on. */
const REQUEST_PRICE_KEYS = new Set(["duration", "aspect_ratio", "count"]);

/** Input modes in which a media role can appear in a valid request. */
function modesFor(role: MediaRole): EndpointMode[] {
  if (role === "start_image") return ["image", "first_last"];
  if (role === "end_image") return ["first_last"];
  return ["reference", "image", "first_last"];
}

/** Representative media combinations for a model: one per input mode it can express. */
function roleSetsFor(m: ModelDefinition): MediaRole[][] {
  const declared = new Set(m.medias.map((slot) => slot.role));
  const required = m.medias.filter((slot) => slot.required).map((slot) => slot.role);
  const sets: MediaRole[][] = [];
  if (required.length === 0) sets.push([]);
  if (declared.has("start_image")) sets.push([...new Set<MediaRole>(["start_image", ...required])]);
  if (declared.has("start_image") && declared.has("end_image")) sets.push([...new Set<MediaRole>(["start_image", "end_image", ...required])]);
  const others = [...declared].filter((role) => role !== "start_image" && role !== "end_image");
  for (const role of others) sets.push([...new Set<MediaRole>([role, ...required])]);
  return sets;
}

describe("seed catalog composition", () => {
  it("exports the three model groups and a matching count", () => {
    expect(SEED_MODELS.length).toBe(IMAGE_MODELS.length + VIDEO_MODELS.length + UTILITY_MODELS.length);
    expect(SEED_MODEL_COUNT).toBe(SEED_MODELS.length);
    expect(IMAGE_MODELS.length).toBeGreaterThanOrEqual(12);
    expect(VIDEO_MODELS.length).toBeGreaterThanOrEqual(15);
    expect(UTILITY_MODELS.length).toBeGreaterThanOrEqual(7);
  });

  it("(1) has unique snake_case ids", () => {
    const ids = SEED_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, `id ${id}`).toMatch(SNAKE_CASE);
    for (const m of SEED_MODELS) for (const hf of m.higgsfield_ids ?? []) expect(hf, `${m.id} higgsfield id ${hf}`).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it("(2) only maps media roles that the model declares", () => {
    for (const m of SEED_MODELS) {
      const declared = new Set(m.medias.map((slot) => slot.role));
      for (const b of m.bindings) {
        for (const role of Object.keys(b.input.roles ?? {})) {
          expect(declared.has(role as MediaRole), `${m.id}/${b.provider}/${b.endpoint} maps undeclared role ${role}`).toBe(true);
        }
      }
    }
  });

  it("(3) only asks providers for multiple outputs when the model allows count >= 2", () => {
    for (const m of SEED_MODELS) {
      for (const b of m.bindings) {
        if (b.input.count) expect(m.max_count ?? DEFAULT_MAX_COUNT, `${m.id}/${b.provider}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("(4) every model has at least one binding and one capability", () => {
    for (const m of SEED_MODELS) {
      expect(m.bindings.length, m.id).toBeGreaterThanOrEqual(1);
      expect(m.capabilities.length, m.id).toBeGreaterThanOrEqual(1);
      expect(m.parameters.length, m.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps bindings internally consistent (endpoint ids, modes, price modifiers, verification metadata)", () => {
    for (const m of SEED_MODELS) {
      const paramNames = new Set(m.parameters.map((p) => p.name));
      for (const b of m.bindings) {
        expect(b.endpoint.trim(), `${m.id}/${b.provider}`).toBe(b.endpoint);
        expect(b.endpoint.length, `${m.id}/${b.provider}`).toBeGreaterThan(0);
        for (const [mode, ep] of Object.entries(b.endpointByMode ?? {})) {
          expect(typeof ep, `${m.id}/${b.provider} endpointByMode.${mode}`).toBe("string");
          expect((ep as string).length, `${m.id}/${b.provider} endpointByMode.${mode}`).toBeGreaterThan(0);
        }
        if (b.provider === "kie") {
          expect(b.endpoint.startsWith("fal-ai/"), `${m.id} kie endpoint looks like a fal id`).toBe(false);
          if (b.family === "veo") expect(b.input.constants?.model, `${m.id} veo binding must send model`).toBe(b.endpoint);
        }
        for (const [name, spec] of Object.entries(b.input.params ?? {})) {
          expect(paramNames.has(name), `${m.id}/${b.provider} maps unknown parameter ${name}`).toBe(true);
          if (typeof spec === "object" && spec.field === "") throw new Error(`${m.id}/${b.provider} empty field for ${name}`);
        }
        for (const modifier of b.pricing?.modifiers ?? []) {
          for (const key of Object.keys(modifier.when)) expect(paramNames.has(key) || REQUEST_PRICE_KEYS.has(key), `${m.id}/${b.provider} price modifier keys on unknown parameter ${key}`).toBe(true);
        }
        if (b.pricing?.scale_param) expect(paramNames.has(b.pricing.scale_param.name), `${m.id}/${b.provider} scale_param`).toBe(true);
        if (b.pricing?.verified) {
          expect(b.pricing.source, `${m.id}/${b.provider} verified price needs a source`).toBeTruthy();
          expect(b.pricing.verified_at, `${m.id}/${b.provider} verified price needs a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
        if (b.verified) expect(b.notes, `${m.id}/${b.provider} verified bindings must say what they were verified against and when`).toMatch(/verified against .+ \(\d{4}-\d{2}(-\d{2})?\)/);
      }
    }
  });

  it("keeps binding constraints valid: pinned values, fixed durations, ignored roles, supported modes", () => {
    for (const m of SEED_MODELS) {
      const params = new Map(m.parameters.map((p) => [p.name, p] as const));
      const declared = new Set(m.medias.map((slot) => slot.role));
      for (const b of m.bindings) {
        const label = `${m.id}/${b.provider}/${b.endpoint}`;
        for (const [name, value] of Object.entries(b.pinnedParams ?? {})) {
          const def = params.get(name);
          expect(def, `${label} pins unknown parameter ${name}`).toBeDefined();
          if (def?.options) expect(def.options, `${label} pins ${name}=${String(value)} outside the options`).toContain(value);
        }
        for (const [name, allowed] of Object.entries(b.supportedParamValues ?? {})) {
          expect(params.has(name), `${label} restricts unknown parameter ${name}`).toBe(true);
          expect(allowed.length, label).toBeGreaterThan(0);
        }
        if (b.fixedDuration !== undefined) expect(b.input.duration, `${label} fixedDuration needs duration: null`).toBeNull();
        for (const role of b.ignoredRoles ?? []) expect(declared.has(role), `${label} ignores undeclared role ${role}`).toBe(true);
        for (const mode of b.supportedModes ?? []) expect(ALL_MODES, label).toContain(mode);
        expect(b.lastResort, `${label} lastResort is for synthesized bindings only`).toBeUndefined();
        expect(b.provider, label).not.toBe("mock");
      }
    }
  });

  it("serves every declared media role on at least one binding, and lists every binding-level role gap explicitly", () => {
    const gaps: string[] = [];
    for (const m of SEED_MODELS) {
      for (const slot of m.medias) {
        const servedBy = m.bindings.filter((b) => b.input.roles?.[slot.role] && b.supportedModes?.some((mode) => modesFor(slot.role).includes(mode)) !== false);
        expect(servedBy.length, `${m.id} declares ${slot.role} but no binding can send it`).toBeGreaterThan(0);
        for (const b of m.bindings) {
          if (b.input.roles?.[slot.role] || b.ignoredRoles?.includes(slot.role)) continue;
          // A role the binding cannot map is fine when its supportedModes exclude every mode the role can appear in.
          const reachable = b.supportedModes === undefined || modesFor(slot.role).some((mode) => b.supportedModes!.includes(mode));
          if (reachable) gaps.push(`${m.id}/${b.provider}/${slot.role}`);
        }
      }
    }
    // The router never picks these bindings for requests carrying the role (see router.test.ts); a new
    // gap must be added here on purpose, or be declared with `ignoredRoles` / `supportedModes`.
    expect(gaps.sort()).toEqual(["gemini_omni_flash_1_1/kie/video_references", "veo_3_1/kie/image_references"]);
  });

  it("never drops an output-changing option silently: an omitted parameter with options is pinned, restricted or exempt", () => {
    // Kie bills GPT Image 2 by resolution and renders its own quality tier; fal's quality tiers are fal-only.
    const exempt = new Set(["gpt_image_2/kie/quality"]);
    const offenders: string[] = [];
    for (const m of SEED_MODELS) {
      for (const b of m.bindings) {
        for (const spec of [b.input, ...Object.values(b.input.byMode ?? {})]) {
          for (const [name, paramSpec] of Object.entries(spec.params ?? {})) {
            const def = m.parameters.find((p) => p.name === name);
            if (typeof paramSpec !== "object" || !paramSpec.omit || !def?.options || !def.affects_cost) continue;
            const handled = b.supportedParamValues?.[name] !== undefined || b.pinnedParams?.[name] !== undefined || exempt.has(`${m.id}/${b.provider}/${name}`);
            if (!handled) offenders.push(`${m.id}/${b.provider}/${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("estimates and sends the same request: duration, count and adjustments agree for every binding and mode", () => {
    for (const m of SEED_MODELS) {
      const durations = m.durations ?? (m.duration_range ? [...new Set([m.duration_range.min, m.default_duration ?? m.duration_range.min, m.duration_range.max])] : [undefined]);
      for (const roles of roleSetsFor(m)) {
        for (const duration of durations) {
          const request = normalizeRequest(m, { model: m.id, prompt: "x", duration, count: m.max_count ?? 4, aspect_ratio: m.aspect_ratios.at(-1), medias: roles.map((role) => ({ role, value: `asset_${role}` })) });
          for (const b of m.bindings) {
            if (!servesRequest(b, request)) continue;
            const label = `${m.id}/${b.provider} [${roles.join(",") || "text"}] ${duration ?? "-"}s`;
            const medias = roles.map((role) => media(role, `https://cdn.example/${role}`));
            const prepared = prepareProviderRequest({ model: m, binding: b, request, medias });
            const spec = resolveInputSpec(b.input, prepared.mode);
            if (spec.duration && prepared.request.duration !== undefined) {
              const sent = getPath(prepared.body, spec.duration.field)[0];
              expect(Number.parseFloat(String(sent)), `${label} body duration`).toBe(prepared.request.duration);
            }
            if (spec.count && prepared.request.count > 1) expect(getPath(prepared.body, spec.count.field)[0], `${label} body count`).toBe(prepared.request.count);
            if (!spec.count) expect(prepared.request.count, `${label} count`).toBe(1);
            const estimate = estimateCost(m, b, request);
            if (!estimate) continue;
            expect(estimate.adjustments ?? [], `${label} adjustments`).toEqual(prepared.adjustments);
            if (estimate.unit === "second" && prepared.request.duration !== undefined && !b.pricing?.scale_param) {
              expect(estimate.quantity, `${label} billed seconds`).toBeCloseTo(prepared.request.duration * prepared.request.count, 6);
            }
          }
        }
      }
    }
  });
});

describe("(5) buildProviderInput on representative models", () => {
  it("builds the fal nano_banana_pro edit body with two references", () => {
    const m = model("nano_banana_pro");
    const b = binding(m, "fal");
    const medias = [media("image_references", "https://cdn.example/ref-1.png"), media("image_references", "https://cdn.example/ref-2.png")];
    const req = request({ model: m.id, prompt: "A cat wearing the sunglasses from image 2", aspect_ratio: "16:9", count: 2, params: { resolution: "2K", output_format: "png" } });
    expect(buildProviderInput(m, b, req, medias)).toEqual({
      prompt: "A cat wearing the sunglasses from image 2",
      aspect_ratio: "16:9",
      num_images: 2,
      image_urls: ["https://cdn.example/ref-1.png", "https://cdn.example/ref-2.png"],
      resolution: "2K",
      output_format: "png",
    });
    expect(resolveEndpoint(b, medias)).toBe("fal-ai/nano-banana-pro/edit");
    expect(resolveEndpoint(b, [])).toBe("fal-ai/nano-banana-pro");
  });

  it("builds the Kie kling-3.0-omni bodies: numeric duration, resolution from mode, audio, aspect_ratio auto with a start image", () => {
    const m = model("kling_3_0");
    const b = binding(m, "kie");
    const medias = [media("start_image", "https://cdn.example/start.png")];
    const req = request({ model: m.id, prompt: "The dog runs through the meadow", aspect_ratio: "16:9", duration: 5, params: { mode: "pro", generate_audio: false } });
    expect(buildProviderInput(m, b, req, medias)).toEqual({
      aspect_ratio: "auto",
      prompt: "The dog runs through the meadow",
      duration: 5,
      image_urls: ["https://cdn.example/start.png"],
      resolution: "1080p",
      audio: false,
    });
    expect(resolveEndpoint(b, medias)).toBe("kling-3.0-omni/image-to-video");
    expect(buildProviderInput(m, b, req, [])).toEqual({ prompt: "The dog runs through the meadow", aspect_ratio: "16:9", duration: 5, resolution: "1080p", audio: false });
    expect(resolveEndpoint(b, [])).toBe("kling-3.0-omni/text-to-video");
  });

  it("appends first and last frame to Kie image_urls in order and translates 4k -> resolution 4k", () => {
    const m = model("kling_3_0");
    const b = binding(m, "kie");
    const medias = [media("end_image", "https://cdn.example/end.png"), media("start_image", "https://cdn.example/start.png")];
    const body = buildProviderInput(m, b, request({ model: m.id, prompt: "x", aspect_ratio: "9:16", duration: 10, params: { mode: "4k", generate_audio: true } }), medias);
    expect(body.image_urls).toEqual(["https://cdn.example/start.png", "https://cdn.example/end.png"]);
    expect(body.resolution).toBe("4k");
    expect(body.audio).toBe(true);
    expect(body.duration).toBe(10);
    expect(body.aspect_ratio).toBe("auto");
    expect(resolveEndpointMode(medias)).toBe("first_last");
    expect(resolveEndpoint(b, medias)).toBe("kling-3.0-omni/image-to-video");
  });

  it("picks the fal Kling image-to-video endpoint from the start image and sends start/end frame fields without a ratio", () => {
    const m = model("kling_3_0");
    const b = binding(m, "fal");
    const medias = [media("start_image", "https://cdn.example/start.png"), media("end_image", "https://cdn.example/end.png")];
    expect(resolveEndpoint(b, medias)).toBe("fal-ai/kling-video/v3/pro/image-to-video");
    expect(resolveEndpoint(b, [])).toBe("fal-ai/kling-video/v3/pro/text-to-video");
    const req = request({ model: m.id, prompt: "x", negative_prompt: "blurry", aspect_ratio: "9:16", duration: 7, params: { mode: "pro", generate_audio: true } });
    expect(buildProviderInput(m, b, req, medias)).toEqual({ prompt: "x", negative_prompt: "blurry", duration: "7", start_image_url: "https://cdn.example/start.png", end_image_url: "https://cdn.example/end.png", generate_audio: true });
    expect(buildProviderInput(m, b, req, [])).toEqual({ prompt: "x", negative_prompt: "blurry", aspect_ratio: "9:16", duration: "7", generate_audio: true });
  });

  it("builds Kling Turbo bodies with a string duration on both providers and no ratio with a start image", () => {
    const m = model("kling_3_0_turbo");
    const start = [media("start_image", "https://cdn.example/start.png")];
    const req = request({ model: m.id, prompt: "x", aspect_ratio: "1:1", duration: 8, params: { resolution: "1080p", generate_audio: false } });
    expect(buildProviderInput(m, binding(m, "kie"), req, start)).toEqual({ prompt: "x", duration: "8", resolution: "1080p", image_urls: ["https://cdn.example/start.png"] });
    expect(buildProviderInput(m, binding(m, "kie"), req, [])).toEqual({ prompt: "x", aspect_ratio: "1:1", duration: "8", resolution: "1080p" });
    expect(buildProviderInput(m, binding(m, "fal"), req, start)).toEqual({ prompt: "x", duration: "8", generate_audio: false, start_image_url: "https://cdn.example/start.png" });
    expect(resolveEndpoint(binding(m, "kie"), start)).toBe("kling/v3-turbo-image-to-video");
  });

  it("builds the Kie veo3 body with imageUrls, the model constant and no duration", () => {
    const m = model("veo_3_1");
    const b = binding(m, "kie");
    expect(b.family).toBe("veo");
    const medias = [media("start_image", "https://cdn.example/start.png")];
    const req = request({ model: m.id, prompt: "Slow push-in on a lighthouse at dusk", aspect_ratio: "16:9", duration: 8, params: { resolution: "720p", generate_audio: true, enable_translation: true } });
    expect(buildProviderInput(m, b, req, medias)).toEqual({
      model: "veo3",
      prompt: "Slow push-in on a lighthouse at dusk",
      aspect_ratio: "16:9",
      imageUrls: ["https://cdn.example/start.png"],
      resolution: "720p",
      enableTranslation: true,
    });
    const fal = binding(m, "fal");
    expect(buildProviderInput(m, fal, req, [])).toEqual({ prompt: "Slow push-in on a lighthouse at dusk", aspect_ratio: "16:9", duration: "8s", resolution: "720p", generate_audio: true });
    expect(resolveEndpoint(fal, [media("image_references", "https://cdn.example/ref.png")])).toBe("fal-ai/veo3.1/reference-to-video");
  });

  it("builds Seedance 2.5 reference bodies for both providers and picks reference endpoints", () => {
    const m = model("seedance_2_5");
    const medias = [media("image_references", "https://cdn.example/p.png"), media("video_references", "https://cdn.example/ad.mp4"), media("audio_references", "https://cdn.example/vo.mp3")];
    const req = request({ model: m.id, prompt: "Swap the product", aspect_ratio: "9:16", duration: 12, params: { resolution: "720p", generate_audio: true, return_last_frame: false } });
    const fal = binding(m, "fal");
    expect(resolveEndpoint(fal, medias)).toBe("bytedance/seedance-2.5/reference-to-video");
    expect(buildProviderInput(m, fal, req, medias)).toEqual({
      prompt: "Swap the product",
      aspect_ratio: "9:16",
      duration: "12",
      image_urls: ["https://cdn.example/p.png"],
      video_urls: ["https://cdn.example/ad.mp4"],
      audio_urls: ["https://cdn.example/vo.mp3"],
      resolution: "720p",
      generate_audio: true,
      return_last_frame: false,
    });
    const kie = binding(m, "kie");
    const kieBody = buildProviderInput(m, kie, req, medias);
    expect(kieBody.reference_image_urls).toEqual(["https://cdn.example/p.png"]);
    expect(kieBody.reference_video_urls).toEqual(["https://cdn.example/ad.mp4"]);
    expect(kieBody.reference_audio_urls).toEqual(["https://cdn.example/vo.mp3"]);
    expect(kieBody.duration).toBe(12);
    expect(kieBody.aspect_ratio).toBe("9:16");
    expect(kieBody.output_format).toBe("mp4");
  });

  it("forces the Seedance ratio to adaptive (Kie) / auto (fal) when a start frame is present", () => {
    const m = model("seedance_2_0");
    const medias = [media("start_image", "https://cdn.example/start.png"), media("end_image", "https://cdn.example/end.png")];
    const req = request({ model: m.id, prompt: "Pan across the room", aspect_ratio: "16:9", duration: 5, params: { resolution: "720p", generate_audio: false } });
    const kie = binding(m, "kie");
    expect(buildProviderInput(m, kie, req, medias)).toEqual({
      output_format: "mp4",
      aspect_ratio: "adaptive",
      prompt: "Pan across the room",
      duration: 5,
      first_frame_url: "https://cdn.example/start.png",
      last_frame_url: "https://cdn.example/end.png",
      resolution: "720p",
      generate_audio: false,
    });
    expect(resolveEndpoint(kie, medias)).toBe("bytedance/seedance-2");
    expect(buildProviderInput(m, kie, req, [])).toEqual({ output_format: "mp4", prompt: "Pan across the room", aspect_ratio: "16:9", duration: 5, resolution: "720p", generate_audio: false });
    const fal = binding(m, "fal");
    expect(buildProviderInput(m, fal, req, medias)).toEqual({
      aspect_ratio: "auto",
      prompt: "Pan across the room",
      duration: "5",
      image_url: "https://cdn.example/start.png",
      end_image_url: "https://cdn.example/end.png",
      resolution: "720p",
      generate_audio: false,
    });
    expect(resolveEndpoint(fal, medias)).toBe("bytedance/seedance-2.0/image-to-video");
  });

  it("switches Wan 2.7 field sets per slug on Kie and caps reference-to-video at 10 s", () => {
    const m = model("wan_2_7");
    const kie = binding(m, "kie");
    const req = request({ model: m.id, prompt: "x", aspect_ratio: "16:9", duration: 15, params: { resolution: "720p" } });
    expect(buildProviderInput(m, kie, req, [])).toEqual({ prompt: "x", ratio: "16:9", duration: 15, resolution: "720p" });
    const refs = [media("image_references", "https://cdn.example/r1.png"), media("image_references", "https://cdn.example/r2.png")];
    expect(buildProviderInput(m, kie, req, refs)).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: 10, resolution: "720p", reference_image: ["https://cdn.example/r1.png", "https://cdn.example/r2.png"] });
    expect(resolveEndpoint(kie, refs)).toBe("wan/2-7-r2v");
    const frames = [media("start_image", "https://cdn.example/s.png"), media("end_image", "https://cdn.example/e.png")];
    expect(buildProviderInput(m, kie, req, frames)).toEqual({ prompt: "x", duration: 15, resolution: "720p", first_frame_url: "https://cdn.example/s.png", last_frame_url: "https://cdn.example/e.png" });
    const fal = binding(m, "fal");
    expect(buildProviderInput(m, fal, req, refs)).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: 10, resolution: "720p", reference_image_urls: ["https://cdn.example/r1.png", "https://cdn.example/r2.png"] });
    expect(buildProviderInput(m, fal, req, frames)).toEqual({ prompt: "x", duration: 15, resolution: "720p", image_url: "https://cdn.example/s.png", end_image_url: "https://cdn.example/e.png" });
  });

  it("sends Grok video duration as a string only on the Kie image-to-video slug and drops the ratio on fal image-to-video", () => {
    const m = model("grok_video");
    const kie = binding(m, "kie");
    const req = request({ model: m.id, prompt: "x", aspect_ratio: "16:9", duration: 6, params: { resolution: "720p", mode: "normal" } });
    expect(buildProviderInput(m, kie, req, [])).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: 6, resolution: "720p", mode: "normal" });
    const start = [media("start_image", "https://cdn.example/s.png")];
    expect(buildProviderInput(m, kie, req, start)).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: "6", resolution: "720p", mode: "normal", image_urls: ["https://cdn.example/s.png"] });
    expect(resolveEndpoint(kie, start)).toBe("grok-imagine/image-to-video");
    const fal = binding(m, "fal");
    expect(buildProviderInput(m, fal, req, start)).toEqual({ prompt: "x", duration: 6, resolution: "720p", image_url: "https://cdn.example/s.png" });
    expect(resolveEndpoint(fal, start)).toBe("xai/grok-imagine-video/v1.5/image-to-video");
  });

  it("clamps MiniMax H3 to 5 s on fal and drops the ratio with a start frame on both providers", () => {
    const m = model("minimax_h3");
    const start = [media("start_image", "https://cdn.example/s.png")];
    const req = request({ model: m.id, prompt: "x", aspect_ratio: "16:9", duration: 4, params: { resolution: "768P" } });
    expect(buildProviderInput(m, binding(m, "fal"), req, start)).toEqual({ prompt: "x", duration: 5, resolution: "768P", image_url: "https://cdn.example/s.png" });
    expect(buildProviderInput(m, binding(m, "kie"), req, start)).toEqual({ prompt: "x", duration: 4, resolution: "768P", first_frame_url: "https://cdn.example/s.png" });
    const refs = [media("image_references", "https://cdn.example/r.png")];
    expect(buildProviderInput(m, binding(m, "fal"), req, refs)).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: 5, resolution: "768P", reference_image_urls: ["https://cdn.example/r.png"] });
  });

  it("builds Hailuo 2.3 Pro bodies: string duration on Kie, no duration/resolution on fal, start frame required", () => {
    const m = model("hailuo_2_3");
    const start = [media("start_image", "https://cdn.example/s.png")];
    const req = request({ model: m.id, prompt: "x", duration: 10, params: { resolution: "768P", prompt_optimizer: true } });
    expect(buildProviderInput(m, binding(m, "kie"), req, start)).toEqual({ prompt: "x", duration: "10", resolution: "768P", image_url: "https://cdn.example/s.png" });
    expect(buildProviderInput(m, binding(m, "fal"), req, start)).toEqual({ prompt: "x", image_url: "https://cdn.example/s.png", prompt_optimizer: true });
    expect(() => normalizeRequest(m, { model: m.id, prompt: "x" })).toThrow(/start_image is required/);
  });

  it("sends GPT Image 2 sizes as OpenAI boxes on fal and image_size auto on the edit endpoint", () => {
    const m = model("gpt_image_2");
    const fal = binding(m, "fal");
    const req = request({ model: m.id, prompt: "A poster", aspect_ratio: "16:9", params: { quality: "medium", output_format: "png" } });
    expect(buildProviderInput(m, fal, req, [])).toEqual({ prompt: "A poster", image_size: { width: 1536, height: 1024 }, quality: "medium", output_format: "png" });
    const refs = [media("image_references", "https://cdn.example/r.png")];
    expect(buildProviderInput(m, fal, req, refs)).toEqual({ image_size: "auto", prompt: "A poster", image_urls: ["https://cdn.example/r.png"], quality: "medium", output_format: "png" });
    expect(resolveEndpoint(fal, refs)).toBe("openai/gpt-image-2/edit");
    const kie = binding(m, "kie");
    expect(buildProviderInput(m, kie, request({ model: m.id, prompt: "A poster", aspect_ratio: "16:9", params: { resolution: "2K" } }), refs)).toEqual({ prompt: "A poster", aspect_ratio: "16:9", input_urls: ["https://cdn.example/r.png"], resolution: "2K" });
    expect(resolveEndpoint(kie, refs)).toBe("gpt-image-2-image-to-image");
  });

  it("maps both Kie GPT Image 2.5 variants and limits narrow ratios to 1K", () => {
    for (const variant of ["flare", "sunburst"]) {
      const m = model(`gpt_image_2_5_${variant}`);
      const kie = binding(m, "kie");
      const req = normalizeRequest(m, { model: m.id, prompt: "A poster", aspect_ratio: "8:9", params: { resolution: "4K" } });
      expect(req.params.resolution).toBe("1K");
      expect(req.adjustments).toEqual([expect.objectContaining({ field: "params.resolution", from: "4K", to: "1K" })]);
      expect(resolveEndpoint(kie, [])).toBe(`gpt-image-2-5-${variant}-text-to-image`);
      const refs = [media("image_references", "https://cdn.example/source.png")];
      expect(resolveEndpoint(kie, refs)).toBe(`gpt-image-2-5-${variant}-image-to-image`);
      expect(buildProviderInput(m, kie, req, refs)).toEqual({ prompt: "A poster", aspect_ratio: "8:9", resolution: "1K", background: "auto", input_urls: ["https://cdn.example/source.png"] });
    }
  });

  it("routes Seedance 2.5 text requests to Higgsfield only at supported settings", () => {
    const m = model("seedance_2_5");
    const hf = binding(m, "higgsfield");
    const router = new ProviderRouter([new HiggsfieldProvider({ credential: "id:secret" })]);
    const supported = normalizeRequest(m, { model: m.id, prompt: "A sunset", duration: 5, params: { resolution: "720p" } });
    expect(router.candidates(m, { request: supported })).toHaveLength(1);
    expect(buildProviderInput(m, hf, supported, [])).toEqual({ prompt: "A sunset", aspect_ratio: "16:9", duration: 5, resolution: "720p", generate_audio: true, output_format: "mp4" });
    const highRes = normalizeRequest(m, { model: m.id, prompt: "A sunset", params: { resolution: "1080p" } });
    expect(router.candidates(m, { request: highRes })).toHaveLength(0);
    const lastFrame = normalizeRequest(m, { model: m.id, prompt: "A sunset", params: { return_last_frame: true } });
    expect(router.candidates(m, { request: lastFrame })).toHaveLength(0);
  });

  it("uses the current Soul Standard schema instead of the older OpenAPI size names", () => {
    const m = model("soul_standard_api");
    const req = normalizeRequest(m, { model: m.id, prompt: "Editorial portrait", aspect_ratio: "4:3", params: { resolution: "1080p", batch_size: 4 } });
    expect(buildProviderInput(m, binding(m, "higgsfield"), req, [])).toEqual({
      prompt: "Editorial portrait", aspect_ratio: "4:3", resolution: "1080p", batch_size: 4, enhance_prompt: true, style_strength: 1,
    });
  });

  it("builds Grok Imagine Image 2.0 bodies with the fal constants and Kie's flat shape", () => {
    const m = model("grok_image_2");
    const refs = [media("image_references", "https://cdn.example/r.png")];
    const req = request({ model: m.id, prompt: "x", aspect_ratio: "3:2", params: { resolution: "2K" } });
    const fal = binding(m, "fal");
    expect(buildProviderInput(m, fal, req, refs)).toEqual({ quality: "low", output_format: "png", prompt: "x", aspect_ratio: "3:2", image_urls: ["https://cdn.example/r.png"], resolution: "2k" });
    expect(resolveEndpoint(fal, refs)).toBe("xai/grok-imagine-image/v2.0/edit");
    const kie = binding(m, "kie");
    expect(buildProviderInput(m, kie, req, refs)).toEqual({ prompt: "x", aspect_ratio: "3:2", image_urls: ["https://cdn.example/r.png"] });
    expect(resolveEndpoint(kie, refs)).toBe("grok-imagine-image-2-0/image-edit");
  });

  it("builds utility bodies without a prompt and translates Wan 3.0 resolution casing on Kie", () => {
    const topaz = model("upscale_image_topaz");
    const body = buildProviderInput(topaz, binding(topaz, "kie"), request({ model: topaz.id, prompt: "ignored", params: { upscale_factor: 4 } }), [media("image", "https://cdn.example/in.png")]);
    expect(body).toEqual({ image_url: "https://cdn.example/in.png", upscale_factor: 4 });
    const wan = model("wan_3_0");
    const wanBody = buildProviderInput(wan, binding(wan, "kie"), request({ model: wan.id, prompt: "x", aspect_ratio: "16:9", duration: 5, params: { resolution: "1080p", generate_audio: true } }), []);
    expect(wanBody).toEqual({ prompt: "x", aspect_ratio: "16:9", duration: 5, resolution: "1080P", audio: true });
  });

  it("normalises a raw request against the catalog (clamps duration, snaps aspect ratio, defaults params)", () => {
    const m = model("kling_3_0");
    const normalized = normalizeRequest(m, { model: m.id, prompt: "x", aspect_ratio: "21:9", duration: 20, medias: [{ role: "start_image", value: "asset_1" }] });
    expect(normalized.duration).toBe(15);
    expect(normalized.aspect_ratio).toBe("16:9");
    expect(normalized.params.mode).toBe("pro");
    expect(normalized.params.generate_audio).toBe(false);
    expect(normalized.adjustments.map((a) => a.field)).toEqual(expect.arrayContaining(["duration", "aspect_ratio"]));
    expect(() => normalizeRequest(model("upscale_image_topaz"), { model: "upscale_image_topaz" })).toThrow(/image is required/);
  });
});

describe("(6) extractOutputs on realistic provider payloads", () => {
  it("reads fal image lists with dimensions", () => {
    const spec = binding(model("nano_banana_pro"), "fal").output;
    const outputs = extractOutputs(spec, { images: [{ url: "https://v3.fal.media/files/b/cat.png", width: 1024, height: 1024, content_type: "image/png" }], seed: 42 });
    expect(outputs).toEqual([{ kind: "image", url: "https://v3.fal.media/files/b/cat.png", width: 1024, height: 1024, content_type: "image/png", seed: 42 }]);
  });

  it("reads fal video objects", () => {
    const spec = binding(model("kling_3_0"), "fal").output;
    const outputs = extractOutputs(spec, { video: { url: "https://v3.fal.media/files/b/dog.mp4", content_type: "video/mp4" } });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ kind: "video", url: "https://v3.fal.media/files/b/dog.mp4", content_type: "video/mp4" });
  });

  it("reads Kie resultUrls string arrays", () => {
    const spec = binding(model("kling_3_0"), "kie").output;
    const outputs = extractOutputs(spec, { resultUrls: ["https://tempfile.aiquickdraw.com/a.mp4", "https://tempfile.aiquickdraw.com/b.mp4"] });
    expect(outputs.map((o) => o.url)).toEqual(["https://tempfile.aiquickdraw.com/a.mp4", "https://tempfile.aiquickdraw.com/b.mp4"]);
    expect(outputs.every((o) => o.kind === "video")).toBe(true);
  });

  it("reads single fal image objects from utilities and ignores non-URL junk", () => {
    const spec = binding(model("upscale_image_topaz"), "fal").output;
    expect(extractOutputs(spec, { image: { url: "https://v3.fal.media/files/b/up.png", width: 4096, height: 4096 } })).toEqual([{ kind: "image", url: "https://v3.fal.media/files/b/up.png", width: 4096, height: 4096 }]);
    expect(extractOutputs(spec, { image: { url: "not-a-url" } })).toEqual([]);
    expect(extractOutputs(spec, {})).toEqual([]);
  });
});
