import { describe, expect, it } from "vitest";
import { normalizeRequest } from "../src/catalog/normalize";
import type { ModelDefinition } from "../src/catalog/types";
import type { Adjustment } from "../src/jobs/types";
import { makeModel, thrown } from "./_helpers";

/** Text-to-image fixture with a rich parameter set and optional reference images. */
const imageModel: ModelDefinition = makeModel({
  id: "fixture_image",
  parameters: [
    { name: "resolution", type: "string", required: false, description: "output tier", options: ["1K", "2K", "4K"], default: "1K" },
    { name: "guidance", type: "number", required: false, description: "cfg scale", min: 1, max: 10 },
    { name: "seed", type: "integer", required: false, description: "seed" },
    { name: "steps", type: "integer", required: false, description: "steps", options: [10, 20, 30] },
    { name: "safe", type: "boolean", required: false, description: "safety checker" },
    { name: "styles", type: "string_array", required: false, description: "style tags", max: 2 },
    { name: "extra", type: "object", required: false, description: "free-form" },
  ],
  medias: [{ role: "image_references", kind: "image", description: "reference images", max: 3 }],
  aspect_ratios: ["1:1", "16:9", "9:16"],
  max_count: 4,
});

/** Image-to-video fixture: required start image, enumerated durations, no aspect ratios. */
const videoModel: ModelDefinition = makeModel({
  id: "fixture_video",
  output_type: "video",
  capabilities: ["image-to-video"],
  medias: [{ role: "image", kind: "image", description: "start frame", required: true }],
  aspect_ratios: [],
  durations: [5, 10],
  default_duration: 5,
});

/** Text-to-video fixture with a duration range and no default. */
const rangeModel: ModelDefinition = makeModel({
  id: "fixture_range",
  output_type: "video",
  capabilities: ["text-to-video"],
  aspect_ratios: ["16:9"],
  duration_range: { min: 2, max: 8 },
});

function adjustmentFor(adjustments: Adjustment[], field: string): Adjustment | undefined {
  return adjustments.find((a) => a.field === field);
}

describe("normalizeRequest", () => {
  describe("prompt", () => {
    it("requires a prompt for text-to-* models without required media", () => {
      const error = thrown(() => normalizeRequest(imageModel, { model: imageModel.id }));
      expect(error.code).toBe("invalid_request");
      expect(error.status).toBe(400);
      expect(error.message).toMatch(/prompt is required/);
    });

    it("treats whitespace-only prompts as missing and trims valid ones", () => {
      expect(thrown(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "   " })).message).toMatch(/prompt is required/);
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "  a fox  " }).prompt).toBe("a fox");
    });

    it("does not require a prompt when the model has required media", () => {
      const result = normalizeRequest(videoModel, { model: videoModel.id, medias: [{ role: "image", value: "asset_1" }] });
      expect(result.prompt).toBeUndefined();
      expect(result.medias).toEqual([{ role: "image", value: "asset_1" }]);
    });

    it("trims negative_prompt and drops it when empty", () => {
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", negative_prompt: "  blurry " }).negative_prompt).toBe("blurry");
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", negative_prompt: "   " }).negative_prompt).toBeUndefined();
    });

    it("returns the canonical shape with the model id", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p" });
      expect(result).toEqual({
        model: "fixture_image",
        prompt: "p",
        negative_prompt: undefined,
        aspect_ratio: "1:1",
        duration: undefined,
        count: 1,
        medias: [],
        params: { resolution: "1K" },
        adjustments: [],
      });
    });
  });

  describe("count", () => {
    it("defaults to 1", () => {
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "p" }).count).toBe(1);
    });

    it("clamps to max_count with an adjustment", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", count: 10 });
      expect(result.count).toBe(4);
      expect(adjustmentFor(result.adjustments, "count")).toMatchObject({ from: 10, to: 4 });
      expect(adjustmentFor(result.adjustments, "count")?.reason).toContain("capped at 4");
    });

    it("uses the default max of 4 when the model does not declare one", () => {
      const result = normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", count: 7 });
      expect(result.count).toBe(4);
    });

    it("raises counts below 1 to 1 with an adjustment", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", count: 0 });
      expect(result.count).toBe(1);
      expect(adjustmentFor(result.adjustments, "count")).toMatchObject({ from: 0, to: 1 });
    });

    it("keeps valid counts untouched", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", count: 3 });
      expect(result.count).toBe(3);
      expect(adjustmentFor(result.adjustments, "count")).toBeUndefined();
    });
  });

  describe("aspect ratio", () => {
    it("defaults to the model's first supported ratio", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p" });
      expect(result.aspect_ratio).toBe("1:1");
      expect(result.adjustments).toEqual([]);
    });

    it("keeps supported ratios as-is (trimmed)", () => {
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", aspect_ratio: " 9:16 " }).aspect_ratio).toBe("9:16");
    });

    it("snaps unsupported ratios to the nearest one with an adjustment", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", aspect_ratio: "3:2" });
      expect(result.aspect_ratio).toBe("16:9");
      expect(adjustmentFor(result.adjustments, "aspect_ratio")).toMatchObject({ from: "3:2", to: "16:9" });
      expect(adjustmentFor(result.adjustments, "aspect_ratio")?.reason).toContain("does not support 3:2");
    });

    it("falls back to the first ratio when the requested one is unparsable", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", aspect_ratio: "auto" });
      expect(result.aspect_ratio).toBe("1:1");
      expect(adjustmentFor(result.adjustments, "aspect_ratio")).toMatchObject({ from: "auto", to: "1:1" });
    });

    it("ignores aspect_ratio (with an adjustment) when the model has none", () => {
      const result = normalizeRequest(videoModel, { model: videoModel.id, aspect_ratio: "16:9", medias: [{ role: "image", value: "a" }] });
      expect(result.aspect_ratio).toBeUndefined();
      expect(adjustmentFor(result.adjustments, "aspect_ratio")).toMatchObject({ from: "16:9", to: undefined });
      expect(adjustmentFor(result.adjustments, "aspect_ratio")?.reason).toContain("ignores aspect_ratio");
    });

    it("emits no adjustment when the model has no ratios and none was requested", () => {
      const result = normalizeRequest(videoModel, { model: videoModel.id, medias: [{ role: "image", value: "a" }] });
      expect(result.aspect_ratio).toBeUndefined();
      expect(adjustmentFor(result.adjustments, "aspect_ratio")).toBeUndefined();
    });
  });

  describe("duration", () => {
    const videoInput = { model: videoModel.id, medias: [{ role: "image" as const, value: "a" }] };

    it("defaults to default_duration, then the first enumerated duration, then the range minimum", () => {
      expect(normalizeRequest(videoModel, videoInput).duration).toBe(5);
      const noDefault = makeModel({ ...videoModel, id: "nodefault", default_duration: undefined, durations: [8, 4] });
      expect(normalizeRequest(noDefault, videoInput).duration).toBe(8);
      expect(normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p" }).duration).toBe(2);
    });

    it("snaps to the nearest enumerated duration with an adjustment", () => {
      const result = normalizeRequest(videoModel, { ...videoInput, duration: 7 });
      expect(result.duration).toBe(5);
      expect(adjustmentFor(result.adjustments, "duration")).toMatchObject({ from: 7, to: 5 });
      expect(adjustmentFor(result.adjustments, "duration")?.reason).toContain("5, 10");
      expect(normalizeRequest(videoModel, { ...videoInput, duration: 8 }).duration).toBe(10);
      expect(normalizeRequest(videoModel, { ...videoInput, duration: 10 }).adjustments).toEqual([]);
    });

    it("clamps to the duration range (after rounding) with an adjustment", () => {
      const high = normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", duration: 12 });
      expect(high.duration).toBe(8);
      expect(adjustmentFor(high.adjustments, "duration")).toMatchObject({ from: 12, to: 8 });
      expect(adjustmentFor(high.adjustments, "duration")?.reason).toContain("2-8s");

      const low = normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", duration: 1 });
      expect(low.duration).toBe(2);

      const fractional = normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", duration: 4.4 });
      expect(fractional.duration).toBe(4);
      expect(adjustmentFor(fractional.adjustments, "duration")).toMatchObject({ from: 4.4, to: 4 });

      const inRange = normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", duration: 6 });
      expect(inRange.duration).toBe(6);
      expect(inRange.adjustments).toEqual([]);
    });

    it("drops duration (with an adjustment) for models without duration support", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", duration: 5 });
      expect(result.duration).toBeUndefined();
      expect(adjustmentFor(result.adjustments, "duration")).toMatchObject({ from: 5, to: undefined });
    });
  });

  describe("params", () => {
    const base = { model: imageModel.id, prompt: "p" };

    it("applies defaults and ignores unknown params with an adjustment", () => {
      const result = normalizeRequest(imageModel, { ...base, params: { bogus: 1 } });
      expect(result.params).toEqual({ resolution: "1K" });
      expect(adjustmentFor(result.adjustments, "params.bogus")).toMatchObject({ from: 1, to: undefined });
      expect(adjustmentFor(result.adjustments, "params.bogus")?.reason).toContain("unknown parameter");
    });

    it("skips null / undefined values (default still applies)", () => {
      const result = normalizeRequest(imageModel, { ...base, params: { resolution: null, guidance: undefined } });
      expect(result.params).toEqual({ resolution: "1K" });
      expect(result.adjustments).toEqual([]);
    });

    it("normalises enum case and rejects unknown enum values", () => {
      const result = normalizeRequest(imageModel, { ...base, params: { resolution: "2k" } });
      expect(result.params.resolution).toBe("2K");
      expect(adjustmentFor(result.adjustments, "params.resolution")).toMatchObject({ from: "2k", to: "2K", reason: "normalised case" });

      const error = thrown(() => normalizeRequest(imageModel, { ...base, params: { resolution: "8K" } }));
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/params\.resolution must be one of 1K, 2K, 4K/);
    });

    it("clamps numbers to min / max with adjustments", () => {
      const high = normalizeRequest(imageModel, { ...base, params: { guidance: 50 } });
      expect(high.params.guidance).toBe(10);
      expect(adjustmentFor(high.adjustments, "params.guidance")).toMatchObject({ from: 50, to: 10, reason: "maximum is 10" });

      const low = normalizeRequest(imageModel, { ...base, params: { guidance: 0 } });
      expect(low.params.guidance).toBe(1);
      expect(adjustmentFor(low.adjustments, "params.guidance")).toMatchObject({ from: 0, to: 1, reason: "minimum is 1" });

      expect(normalizeRequest(imageModel, { ...base, params: { guidance: "7.5" } }).params.guidance).toBe(7.5);
    });

    it("rounds integers and snaps them to enumerated options", () => {
      expect(normalizeRequest(imageModel, { ...base, params: { seed: 3.7 } }).params.seed).toBe(4);
      const snapped = normalizeRequest(imageModel, { ...base, params: { steps: 24 } });
      expect(snapped.params.steps).toBe(20);
      expect(adjustmentFor(snapped.adjustments, "params.steps")).toMatchObject({ from: 24, to: 20 });
    });

    it("rejects non-numeric numbers", () => {
      expect(thrown(() => normalizeRequest(imageModel, { ...base, params: { guidance: "lots" } })).message).toMatch(/params\.guidance must be a number/);
    });

    it("coerces booleans from strings and rejects other values", () => {
      expect(normalizeRequest(imageModel, { ...base, params: { safe: "true" } }).params.safe).toBe(true);
      expect(normalizeRequest(imageModel, { ...base, params: { safe: false } }).params.safe).toBe(false);
      expect(thrown(() => normalizeRequest(imageModel, { ...base, params: { safe: "yes" } })).message).toMatch(/params\.safe must be a boolean/);
    });

    it("truncates string arrays to max and rejects non-string arrays", () => {
      const result = normalizeRequest(imageModel, { ...base, params: { styles: ["a", "b", "c"] } });
      expect(result.params.styles).toEqual(["a", "b"]);
      expect(adjustmentFor(result.adjustments, "params.styles")).toMatchObject({ from: 3, to: 2 });
      expect(thrown(() => normalizeRequest(imageModel, { ...base, params: { styles: "a" } })).message).toMatch(/must be an array of strings/);
      expect(thrown(() => normalizeRequest(imageModel, { ...base, params: { styles: [1] } })).message).toMatch(/must be an array of strings/);
    });

    it("passes objects through and rejects non-objects", () => {
      expect(normalizeRequest(imageModel, { ...base, params: { extra: { k: 1 } } }).params.extra).toEqual({ k: 1 });
      expect(thrown(() => normalizeRequest(imageModel, { ...base, params: { extra: "nope" } })).message).toMatch(/params\.extra must be an object/);
    });

    it("requires parameters flagged required without a default", () => {
      const strict = makeModel({ parameters: [{ name: "voice", type: "string", required: true, description: "voice id" }] });
      expect(thrown(() => normalizeRequest(strict, { model: strict.id, prompt: "p" })).message).toMatch(/parameter voice is required/);
      expect(normalizeRequest(strict, { model: strict.id, prompt: "p", params: { voice: "v1" } }).params).toEqual({ voice: "v1" });
    });
  });

  describe("medias", () => {
    it("fails when a required media role is missing", () => {
      const error = thrown(() => normalizeRequest(videoModel, { model: videoModel.id, prompt: "p" }));
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/media role image is required for fixture_video/);
    });

    it("coerces image -> image_references when only the plural role exists", () => {
      const result = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", medias: [{ role: "image", value: "asset_1" }] });
      expect(result.medias).toEqual([{ role: "image_references", value: "asset_1" }]);
      expect(adjustmentFor(result.adjustments, "medias.role")).toMatchObject({ from: "image", to: "image_references" });
    });

    it("coerces image_references -> image when only the singular role exists", () => {
      const result = normalizeRequest(videoModel, { model: videoModel.id, medias: [{ role: "image_references", value: "asset_1" }] });
      expect(result.medias).toEqual([{ role: "image", value: "asset_1" }]);
      expect(adjustmentFor(result.adjustments, "medias.role")).toMatchObject({ from: "image_references", to: "image" });
    });

    it("rejects roles the model does not support", () => {
      const error = thrown(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", medias: [{ role: "audio", value: "a" }] }));
      expect(error.message).toMatch(/media role audio is not supported by fixture_image \(supported: image_references\)/);
    });

    it("rejects too many medias for a role", () => {
      const medias = ["a", "b", "c", "d"].map((value) => ({ role: "image_references" as const, value }));
      const error = thrown(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", medias }));
      expect(error.message).toMatch(/at most 3 media item\(s\) allowed for role image_references/);

      const three = normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", medias: medias.slice(0, 3) });
      expect(three.medias).toHaveLength(3);
    });

    it("singular roles default to max 1", () => {
      const error = thrown(() =>
        normalizeRequest(videoModel, {
          model: videoModel.id,
          medias: [
            { role: "image", value: "a" },
            { role: "image", value: "b" },
          ],
        }),
      );
      expect(error.message).toMatch(/at most 1 media item\(s\) allowed for role image/);
    });

    it("rejects medias with empty values", () => {
      const error = thrown(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", medias: [{ role: "image_references", value: "  " }] }));
      expect(error.message).toMatch(/each media needs a non-empty value/);
    });
  });

  describe("type guards (core is reusable by front-ends without a schema layer)", () => {
    const frames: ModelDefinition = makeModel({
      id: "fixture_frames",
      output_type: "video",
      capabilities: ["text-to-video", "first-last-frame-to-video"],
      medias: [
        { role: "start_image", kind: "image", description: "first frame" },
        { role: "end_image", kind: "image", description: "last frame", requires: "start_image" },
      ],
      aspect_ratios: ["16:9"],
      duration_range: { min: 2, max: 8 },
    });

    it("rejects an end frame without a start frame", () => {
      const error = thrown(() => normalizeRequest(frames, { model: frames.id, prompt: "p", medias: [{ role: "end_image", value: "asset_end" }] }));
      expect(error.message).toMatch(/media role end_image requires start_image/);
      const ok = normalizeRequest(frames, { model: frames.id, prompt: "p", medias: [{ role: "start_image", value: "s" }, { role: "end_image", value: "e" }] });
      expect(ok.medias.map((m) => m.role)).toEqual(["start_image", "end_image"]);
    });

    it("rejects non-string prompts, ratios and negative prompts instead of throwing a TypeError", () => {
      const bad = { model: imageModel.id, prompt: 42, negative_prompt: ["x"], aspect_ratio: 16 } as unknown as Parameters<typeof normalizeRequest>[1];
      const error = thrown(() => normalizeRequest(imageModel, bad));
      expect(error.message).toMatch(/prompt must be a string/);
      expect(error.message).toMatch(/negative_prompt must be a string/);
      expect(error.message).toMatch(/aspect_ratio must be a string/);
    });

    it("rejects NaN / infinite / non-numeric durations", () => {
      for (const duration of [Number.NaN, Number.POSITIVE_INFINITY, "5" as unknown as number]) {
        expect(() => normalizeRequest(rangeModel, { model: rangeModel.id, prompt: "p", duration }), String(duration)).toThrow(/duration must be a finite number/);
      }
    });

    it("does not coerce empty strings or booleans into numbers, nor objects into strings", () => {
      expect(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", params: { seed: "" } })).toThrow(/params\.seed must be a number/);
      expect(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", params: { guidance: true } })).toThrow(/params\.guidance must be a number/);
      expect(normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", params: { seed: " 7 " } }).params.seed).toBe(7);
      expect(() => normalizeRequest(imageModel, { model: imageModel.id, prompt: "p", params: { resolution: { a: 1 } } })).toThrow(/params\.resolution must be a string/);
    });

    it("rejects medias and params of the wrong shape", () => {
      const notArray = { model: imageModel.id, prompt: "p", medias: { role: "image_references", value: "x" } } as unknown as Parameters<typeof normalizeRequest>[1];
      expect(() => normalizeRequest(imageModel, notArray)).toThrow(/medias must be an array/);
      const notObject = { model: imageModel.id, prompt: "p", params: "resolution=4K" } as unknown as Parameters<typeof normalizeRequest>[1];
      expect(() => normalizeRequest(imageModel, notObject)).toThrow(/params must be an object/);
    });
  });

  describe("error reporting", () => {
    it("collects every error and the adjustments made so far in details", () => {
      const error = thrown(() =>
        normalizeRequest(imageModel, {
          model: imageModel.id,
          count: 99,
          params: { resolution: "8K", safe: "maybe" },
        }),
      );
      expect(error.code).toBe("invalid_request");
      const details = error.details as { errors: string[]; adjustments: Adjustment[] };
      expect(details.errors).toHaveLength(3);
      expect(details.errors[0]).toMatch(/prompt is required/);
      expect(details.errors).toEqual(expect.arrayContaining([expect.stringMatching(/params\.resolution/), expect.stringMatching(/params\.safe/)]));
      expect(adjustmentFor(details.adjustments, "count")).toMatchObject({ from: 99, to: 4 });
      expect(error.message).toBe(details.errors.join("; "));
    });
  });
});
