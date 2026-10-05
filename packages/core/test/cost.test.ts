import { describe, expect, it } from "vitest";
import { estimateCost } from "../src/cost/index";
import type { Pricing } from "../src/catalog/types";
import { SEED_MODELS } from "../src/catalog/models/index";
import { normalizeRequest } from "../src/catalog/normalize";
import { falBinding, kieBinding, makeModel, makeRequest } from "./_helpers";

const imageModel = makeModel();
const videoModel = makeModel({ id: "fixture_video", output_type: "video", capabilities: ["text-to-video"], durations: [4, 8], default_duration: 6 });

function priced(pricing: Pricing | undefined) {
  return falBinding({ pricing });
}

describe("estimateCost", () => {
  it("returns undefined when the binding has no pricing", () => {
    expect(estimateCost(imageModel, priced(undefined), makeRequest())).toBeUndefined();
  });

  it("charges per image: count × price", () => {
    const estimate = estimateCost(imageModel, priced({ unit: "image", usd: 0.04, verified: true }), makeRequest({ count: 3 }));
    expect(estimate).toEqual({
      usd: 0.12,
      currency: "USD",
      unit: "image",
      quantity: 3,
      unitPriceUsd: 0.04,
      breakdown: "3 × $0.0400 per image = $0.1200",
      verified: true,
      provider: "fal",
      endpoint: "fal-ai/fixture",
    });
  });

  it("treats `generation` like a flat per-call price", () => {
    const estimate = estimateCost(imageModel, priced({ unit: "generation", usd: 0.5 }), makeRequest({ count: 2 }));
    expect(estimate?.usd).toBe(1);
    expect(estimate?.quantity).toBe(2);
    expect(estimate?.verified).toBe(false);
  });

  describe("megapixel", () => {
    const pricing: Pricing = { unit: "megapixel", usd: 0.03 };

    it("uses 1:1 at 1k = 1.049 MP (megapixels rounds up to 3 decimals)", () => {
      const estimate = estimateCost(imageModel, priced(pricing), makeRequest({ aspect_ratio: "1:1" }));
      expect(estimate?.quantity).toBe(1.049);
      expect(estimate?.usd).toBe(0.0315); // 0.03147 rounded to 4 decimals
      expect(estimate?.breakdown).toBe("1 × 1.049 MP × $0.0300 per MP = $0.0315");
    });

    it("defaults to 1:1 when the request has no aspect ratio and multiplies by count", () => {
      const estimate = estimateCost(imageModel, priced(pricing), makeRequest({ count: 2 }));
      expect(estimate?.quantity).toBeCloseTo(2.098, 10);
      expect(estimate?.usd).toBe(0.0629); // 0.06294
    });

    it("accounts for the aspect ratio", () => {
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ aspect_ratio: "16:9" }))?.quantity).toBe(0.59); // 1024×576
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ aspect_ratio: "9:16" }))?.quantity).toBe(0.59);
    });

    it("reads the resolution tier from params.resolution / params.quality", () => {
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "2K" } }))?.quantity).toBe(4.195);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "4k" } }))?.quantity).toBe(16.778);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "2048x2048" } }))?.quantity).toBe(4.195);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { quality: "high" } }))?.quantity).toBe(4.195);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "1K" } }))?.quantity).toBe(1.049);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "standard" } }))?.quantity).toBe(1.049);
    });
  });

  describe("second", () => {
    const pricing: Pricing = { unit: "second", usd: 0.05 };

    it("charges duration × count", () => {
      const estimate = estimateCost(videoModel, priced(pricing), makeRequest({ duration: 8, count: 2 }));
      expect(estimate?.quantity).toBe(16);
      expect(estimate?.usd).toBe(0.8);
      expect(estimate?.breakdown).toBe("2 × 8s × $0.0500 per second = $0.8000");
    });

    it("falls back to default_duration, then the first listed duration, then the range min, then 5", () => {
      expect(estimateCost(videoModel, priced(pricing), makeRequest())?.quantity).toBe(6);
      const listed = makeModel({ durations: [4, 8] });
      expect(estimateCost(listed, priced(pricing), makeRequest())?.quantity).toBe(4);
      const ranged = makeModel({ duration_range: { min: 3, max: 10 } });
      expect(estimateCost(ranged, priced(pricing), makeRequest())?.quantity).toBe(3);
      expect(estimateCost(imageModel, priced(pricing), makeRequest())?.quantity).toBe(5);
    });
  });

  it("charges per minute from a duration in seconds", () => {
    const estimate = estimateCost(videoModel, priced({ unit: "minute", usd: 0.6 }), makeRequest({ duration: 30 }));
    expect(estimate?.quantity).toBe(0.5);
    expect(estimate?.usd).toBe(0.3);
    expect(estimate?.breakdown).toBe("1 × 0.50 min × $0.6000 per minute = $0.3000");
    expect(estimateCost(videoModel, priced({ unit: "minute", usd: 0.6 }), makeRequest())?.quantity).toBe(0.1); // default_duration 6s
    expect(estimateCost(imageModel, priced({ unit: "minute", usd: 0.6 }), makeRequest())?.quantity).toBe(1); // 60s fallback
  });

  it("charges per thousand characters of prompt, rounding up and never below one block", () => {
    const pricing: Pricing = { unit: "thousand_chars", usd: 0.015 };
    const long = estimateCost(imageModel, priced(pricing), makeRequest({ prompt: "x".repeat(1500) }));
    expect(long?.quantity).toBe(2);
    expect(long?.usd).toBe(0.03);
    expect(long?.breakdown).toBe("1 × 2k chars × $0.0150 per 1k chars = $0.0300");
    expect(estimateCost(imageModel, priced(pricing), makeRequest({ prompt: "x".repeat(1000) }))?.quantity).toBe(1);
    expect(estimateCost(imageModel, priced(pricing), makeRequest({ prompt: "" }))?.quantity).toBe(1);
    expect(estimateCost(imageModel, priced(pricing), makeRequest({ prompt: undefined }))?.quantity).toBe(1);
    expect(estimateCost(imageModel, priced(pricing), makeRequest({ prompt: "x".repeat(2001), count: 2 }))?.quantity).toBe(6);
  });

  describe("modifiers", () => {
    const pricing: Pricing = {
      unit: "image",
      usd: 0.04,
      modifiers: [
        { when: { resolution: "4K" }, usd: 0.3 },
        { when: { resolution: "2K" }, usd: 0.15 },
        { when: { resolution: "2K", audio: true }, usd: 0.99 },
      ],
      notes: "4K costs more",
    };

    it("uses the first matching modifier's price", () => {
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "4K" } }))?.unitPriceUsd).toBe(0.3);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "2K" } }))?.unitPriceUsd).toBe(0.15);
      expect(estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "2K", audio: true } }))?.unitPriceUsd).toBe(0.15);
    });

    it("requires every condition to match and compares by string value", () => {
      const both: Pricing = { unit: "image", usd: 0.04, modifiers: [{ when: { resolution: "2K", audio: true }, usd: 0.99 }] };
      expect(estimateCost(imageModel, priced(both), makeRequest({ params: { resolution: "2K" } }))?.unitPriceUsd).toBe(0.04);
      expect(estimateCost(imageModel, priced(both), makeRequest({ params: { resolution: "2K", audio: true } }))?.unitPriceUsd).toBe(0.99);
      expect(estimateCost(imageModel, priced(both), makeRequest({ params: { resolution: "2K", audio: "true" } }))?.unitPriceUsd).toBe(0.99);
      expect(estimateCost(imageModel, priced(both), makeRequest({ params: { resolution: "2K", audio: false } }))?.unitPriceUsd).toBe(0.04);
    });

    it("falls back to the base price and appends pricing notes to the breakdown", () => {
      const estimate = estimateCost(imageModel, priced(pricing), makeRequest({ params: { resolution: "1K" } }));
      expect(estimate?.unitPriceUsd).toBe(0.04);
      expect(estimate?.usd).toBe(0.04);
      expect(estimate?.breakdown).toBe("1 × $0.0400 per image = $0.0400 (4K costs more)");
    });
  });

  it("reports the binding's provider and endpoint", () => {
    const estimate = estimateCost(imageModel, kieBinding({ pricing: { unit: "image", usd: 0.02 } }), makeRequest());
    expect(estimate?.provider).toBe("kie");
    expect(estimate?.endpoint).toBe("fixture/image");
    expect(estimate?.usd).toBe(0.02);
  });

  describe("pricing extensions", () => {
    it("bills the first megapixel at first_unit_usd and the rest at usd", () => {
      const pricing: Pricing = { unit: "megapixel", usd: 0.015, first_unit_usd: 0.03 };
      const square = estimateCost(imageModel, priced(pricing), makeRequest({ aspect_ratio: "1:1", count: 2 }));
      // 1024x1024 = 1.049 MP: $0.03 + 0.049 x $0.015 per image.
      expect(square?.usd).toBe(0.0615);
      expect(square?.breakdown).toMatch(/first MP \$0\.0300 \+ 0\.049 MP/);
    });

    it("scales megapixels by a parameter (upscale factor squared)", () => {
      const upscaler = makeModel({ id: "fixture_upscale", aspect_ratios: [], parameters: [{ name: "upscale_factor", type: "integer", required: false, description: "x", options: [2, 4], default: 2 }] });
      const pricing: Pricing = { unit: "megapixel", usd: 0.03, scale_param: { name: "upscale_factor", exponent: 2 } };
      const x2 = estimateCost(upscaler, priced(pricing), makeRequest({ params: { upscale_factor: 2 } }));
      const x4 = estimateCost(upscaler, priced(pricing), makeRequest({ params: { upscale_factor: 4 } }));
      expect(x2?.quantity).toBe(4.196);
      expect(x4?.quantity).toBe(16.784);
      expect(x4?.breakdown).toMatch(/upscale_factor 4, assuming a ~1 MP source/);
    });

    it("lets modifiers key on duration, aspect ratio and count", () => {
      const pricing: Pricing = { unit: "second", usd: 0.04, modifiers: [{ when: { duration: 10 }, usd: 0.045 }, { when: { aspect_ratio: "9:16" }, usd: 0.05 }] };
      expect(estimateCost(videoModel, priced(pricing), makeRequest({ duration: 10 }))?.unitPriceUsd).toBe(0.045);
      expect(estimateCost(videoModel, priced(pricing), makeRequest({ duration: 4, aspect_ratio: "9:16" }))?.unitPriceUsd).toBe(0.05);
      expect(estimateCost(videoModel, priced(pricing), makeRequest({ duration: 4 }))?.unitPriceUsd).toBe(0.04);
    });

    it("marks input-dependent estimates as unverified and says why", () => {
      const estimate = estimateCost(videoModel, priced({ unit: "second", usd: 0.1, verified: true, input_dependent: true }), makeRequest({ duration: 8 }));
      expect(estimate?.verified).toBe(false);
      expect(estimate?.breakdown).toMatch(/output length follows the input media/);
    });

    it("prices what the binding will run: clamped duration, one output per job, pinned tier", () => {
      const clamped = falBinding({ input: { duration: { field: "duration", max: 5 }, count: null }, pinnedParams: { resolution: "1080p" }, pricing: { unit: "second", usd: 0.1, modifiers: [{ when: { resolution: "1080p" }, usd: 0.2 }] } });
      const estimate = estimateCost(videoModel, clamped, makeRequest({ duration: 8, count: 2, params: { resolution: "720p" } }));
      expect(estimate).toMatchObject({ usd: 1, quantity: 5, unitPriceUsd: 0.2 });
      expect(estimate?.adjustments?.map((a) => a.field)).toEqual(["params.resolution", "duration", "count"]);
      expect(estimateCost(videoModel, priced({ unit: "second", usd: 0.1 }), makeRequest({ duration: 8 }))?.adjustments).toBeUndefined();
    });

    it("estimates the seed catalog consistently for the audited cases", () => {
      const model = (id: string) => SEED_MODELS.find((m) => m.id === id)!;
      const binding = (id: string, provider: string) => model(id).bindings.find((b) => b.provider === provider)!;
      const wan = model("wan_2_7");
      const refs = normalizeRequest(wan, { model: wan.id, prompt: "x", duration: 15, medias: [{ role: "image_references", value: "r" }] });
      expect(estimateCost(wan, binding("wan_2_7", "kie"), refs)).toMatchObject({ quantity: 10, usd: 0.8 });
      const flux = model("flux_2_max");
      const twoK = normalizeRequest(flux, { model: flux.id, prompt: "x", params: { resolution: "2K" } });
      expect(twoK.params.resolution).toBeUndefined();
      expect(estimateCost(flux, binding("flux_2_max", "fal"), twoK)?.usd).toBe(estimateCost(flux, binding("flux_2_max", "fal"), normalizeRequest(flux, { model: flux.id, prompt: "x" }))?.usd);
      const clarity = model("upscale_image_clarity");
      const x2 = normalizeRequest(clarity, { model: clarity.id, params: { upscale_factor: 2 }, medias: [{ role: "image", value: "i" }] });
      const x4 = normalizeRequest(clarity, { model: clarity.id, params: { upscale_factor: 4 }, medias: [{ role: "image", value: "i" }] });
      expect(estimateCost(clarity, binding("upscale_image_clarity", "fal"), x4)!.usd).toBeGreaterThan(estimateCost(clarity, binding("upscale_image_clarity", "fal"), x2)!.usd * 3.9);
      const veo = model("veo_3_1");
      const fourSeconds = normalizeRequest(veo, { model: veo.id, prompt: "x", duration: 4 });
      expect(estimateCost(veo, binding("veo_3_1", "kie"), fourSeconds)?.adjustments).toEqual([expect.objectContaining({ field: "duration", from: 4, to: 8 })]);
    });
  });

  it("rounds the total to four decimals", () => {
    const estimate = estimateCost(imageModel, priced({ unit: "image", usd: 0.0333333 }), makeRequest({ count: 3 }));
    expect(estimate?.usd).toBe(0.1);
    expect(estimate?.unitPriceUsd).toBe(0.0333333);
  });
});
