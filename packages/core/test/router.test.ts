import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bindingRejections, DEFAULT_PROVIDER_PREFERENCE, ProviderRouter, servesRequest } from "../src/router/index";
import { FalProvider } from "../src/providers/fal/index";
import { KieProvider } from "../src/providers/kie/index";
import { MockProvider } from "../src/providers/mock/index";
import { SEED_MODELS } from "../src/catalog/models/index";
import { normalizeRequest } from "../src/catalog/normalize";
import { resolveEndpoint } from "../src/catalog/mapping";
import { estimateCost } from "../src/cost/index";
import { PROVIDER_IDS, type ModelDefinition, type ProviderId } from "../src/catalog/types";
import type { GenerateRequest } from "../src/jobs/types";
import type { ProviderAdapter, SubmitInput, SubmitResult } from "../src/providers/types";
import { ambiguousSubmit, rejectedSubmit, StudioError } from "../src/util/errors";
import { createFakeFetch, falBinding, kieBinding, makeModel, makeRequest, mockBinding, rejection, thrown } from "./_helpers";

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const name of ["FAL_KEY", "KIE_API_KEY"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterAll(() => {
  for (const [name, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[name] = value;
});

const fetch = createFakeFetch().fetch;
const fal = new FalProvider({ apiKey: "fal-key", fetch });
const kieWithoutKey = new KieProvider({ fetch });
const kie = new KieProvider({ apiKey: "kie-key", fetch });
const mock = new MockProvider();

/** fal $0.04 (priority 2), kie $0.02 (priority 1), mock unpriced (priority 3). */
const model: ModelDefinition = makeModel({
  bindings: [falBinding({ priority: 2, pricing: { unit: "image", usd: 0.04 } }), kieBinding({ priority: 1, pricing: { unit: "image", usd: 0.02 } }), mockBinding({ priority: 3 })],
});

const ids = (list: Array<{ provider: { id: string } }>) => list.map((c) => c.provider.id);

describe("ProviderRouter", () => {
  describe("candidates", () => {
    it("skips providers that are not configured and unknown providers", () => {
      const router = new ProviderRouter([fal, kieWithoutKey, mock]);
      expect(ids(router.candidates(model))).toEqual(["fal", "mock"]);
      expect(router.availableProviders()).toEqual(["fal", "mock"]);
      expect(ids(new ProviderRouter([fal]).candidates(makeModel({ bindings: [kieBinding()] })))).toEqual([]);
    });

    it("preferred strategy follows the preference order (default kie, fal, mock)", () => {
      expect(ids(new ProviderRouter([mock, kie, fal]).candidates(model))).toEqual(["kie", "fal", "mock"]);
      expect(ids(new ProviderRouter([fal, kie, mock], { preference: ["mock", "kie", "fal"] }).candidates(model))).toEqual(["mock", "kie", "fal"]);
    });

    it("providers missing from the preference list sort last, then by binding priority", () => {
      const router = new ProviderRouter([fal, kie, mock], { preference: ["fal"] });
      expect(ids(router.candidates(model))).toEqual(["fal", "kie", "mock"]);
    });

    it("breaks preference ties between bindings of the same provider by priority", () => {
      const twoFal = makeModel({ bindings: [falBinding({ endpoint: "fal-ai/slow", priority: 5 }), falBinding({ endpoint: "fal-ai/fast", priority: 1 })] });
      expect(new ProviderRouter([fal]).candidates(twoFal).map((c) => c.binding.endpoint)).toEqual(["fal-ai/fast", "fal-ai/slow"]);
    });

    it("cheapest strategy sorts by pricing.usd (unpriced bindings fall back to preference order)", () => {
      const router = new ProviderRouter([fal, kie, mock], { strategy: "cheapest" });
      expect(ids(router.candidates(model))).toEqual(["kie", "fal", "mock"]);

      const pricedMock = makeModel({ bindings: [falBinding({ pricing: { unit: "image", usd: 0.05 } }), mockBinding({ pricing: { unit: "image", usd: 0.01 } })] });
      expect(ids(router.candidates(pricedMock))).toEqual(["mock", "fal"]);

      const tie = makeModel({ bindings: [kieBinding({ pricing: { unit: "image", usd: 0.03 } }), falBinding({ pricing: { unit: "image", usd: 0.03 } })] });
      expect(ids(router.candidates(tie))).toEqual(["kie", "fal"]);
    });

    it("uses the total price for the requested resolution, not the cheapest base tier", () => {
      const router = new ProviderRouter([fal, kie], { strategy: "cheapest" });
      const tiered = makeModel({ bindings: [
        falBinding({ pricing: { unit: "image", usd: 0.02, modifiers: [{ when: { resolution: "4K" }, usd: 0.10 }] } }),
        kieBinding({ pricing: { unit: "image", usd: 0.04, modifiers: [{ when: { resolution: "4K" }, usd: 0.05 }] } }),
      ] });
      expect(ids(router.candidates(tiered))).toEqual(["fal", "kie"]);
      expect(ids(router.candidates(tiered, { request: makeRequest({ params: { resolution: "4K" } }) }))).toEqual(["kie", "fal"]);
    });

    it("quality strategy sorts by binding.priority (lower first), then preference", () => {
      const router = new ProviderRouter([fal, kie, mock], { strategy: "quality" });
      expect(ids(router.candidates(model))).toEqual(["kie", "fal", "mock"]);

      const samePriority = makeModel({ bindings: [mockBinding({ priority: 1 }), kieBinding({ priority: 1 }), falBinding({ priority: undefined })] });
      expect(ids(router.candidates(samePriority))).toEqual(["kie", "mock", "fal"]);
    });

    it("per-call strategy overrides the router default", () => {
      const router = new ProviderRouter([fal, kie, mock], { preference: ["fal", "kie", "mock"] });
      expect(ids(router.candidates(model, { strategy: "cheapest" }))).toEqual(["kie", "fal", "mock"]);
      expect(ids(router.candidates(model))).toEqual(["fal", "kie", "mock"]);
    });

    it("filters by provider", () => {
      const router = new ProviderRouter([fal, kie, mock]);
      expect(ids(router.candidates(model, { provider: "mock" }))).toEqual(["mock"]);
      expect(router.candidates(model, { provider: "mock" })[0]?.binding.endpoint).toBe("mock/fixture");
      expect(ids(new ProviderRouter([fal, kieWithoutKey, mock]).candidates(model, { provider: "kie" }))).toEqual([]);
    });

    it("honours the disabled list", () => {
      const router = new ProviderRouter([fal, kie, mock], { disabled: ["fal"] });
      expect(ids(router.candidates(model))).toEqual(["kie", "mock"]);
      expect(router.availableProviders()).toEqual(["kie", "mock"]);
      expect(router.getProvider("fal")).toBe(fal);
    });
  });

  describe("route", () => {
    it("returns the first candidate plus the remaining fallbacks", () => {
      const decision = new ProviderRouter([fal, kieWithoutKey, mock]).route(model);
      expect(decision.provider).toBe(fal);
      expect(decision.binding.provider).toBe("fal");
      expect(decision.binding.endpoint).toBe("fal-ai/fixture");
      expect(decision.fallbacks.map((f) => f.provider.id)).toEqual(["mock"]);
      expect(decision.fallbacks[0]?.binding).toBe(model.bindings[2]);
    });

    it("lists every remaining candidate as a fallback in order", () => {
      const decision = new ProviderRouter([fal, kie, mock], { strategy: "cheapest" }).route(model);
      expect(decision.provider).toBe(kie);
      expect(decision.fallbacks.map((f) => f.provider.id)).toEqual(["fal", "mock"]);
    });

    it("throws provider_unavailable when nothing is configured", () => {
      const error = thrown(() => new ProviderRouter([kieWithoutKey]).route(model));
      expect(error.code).toBe("provider_unavailable");
      expect(error.status).toBe(503);
      expect(error.message).toBe("no configured provider can serve fixture_image (configured: none)");
    });

    it("mentions the requested provider and the configured ones when a filter cannot be satisfied", () => {
      const error = thrown(() => new ProviderRouter([fal, kieWithoutKey, mock]).route(model, { provider: "kie" }));
      expect(error.code).toBe("provider_unavailable");
      expect(error.message).toBe("no configured provider can serve fixture_image via kie (configured: fal, mock)");
    });

    it("throws when the model has no bindings for any registered provider", () => {
      const error = thrown(() => new ProviderRouter([mock]).route(makeModel({ bindings: [falBinding()] })));
      expect(error.code).toBe("provider_unavailable");
    });
  });

  describe("getProvider", () => {
    it("returns registered adapters by id", () => {
      const router = new ProviderRouter([fal, mock]);
      expect(router.getProvider("fal")).toBe(fal);
      expect(router.getProvider("mock")).toBe(mock);
      expect(router.getProvider("kie")).toBeUndefined();
    });
  });

  it("orders the default preference over known provider ids only", () => {
    expect([...DEFAULT_PROVIDER_PREFERENCE].sort()).toEqual([...PROVIDER_IDS].sort());
  });
});

describe("ProviderRouter on the seed catalog", () => {
  function seed(id: string): ModelDefinition {
    const found = SEED_MODELS.find((m) => m.id === id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  }
  const normalized = (model: ModelDefinition, request: Omit<GenerateRequest, "model">) => normalizeRequest(model, { model: model.id, prompt: "x", ...request });
  const pick = (router: ProviderRouter, model: ModelDefinition, request: Omit<GenerateRequest, "model">) => {
    const normalizedRequest = normalized(model, request);
    const decision = router.route(model, { request: normalizedRequest });
    return `${decision.provider.id} ${resolveEndpoint(decision.binding, normalizedRequest.medias)}`;
  };
  const both = new ProviderRouter([fal, kie]);
  const bothCheapest = new ProviderRouter([fal, kie], { strategy: "cheapest" });

  it("never sends reference media to a binding that cannot map it (Veo image references go to fal reference-to-video)", () => {
    const veo = seed("veo_3_1");
    const refs = { medias: [{ role: "image_references" as const, value: "asset_1" }] };
    for (const router of [both, bothCheapest]) {
      const decision = router.route(veo, { request: normalized(veo, refs) });
      expect(decision.provider.id).toBe("fal");
      expect(decision.fallbacks).toEqual([]);
    }
    // start frame + references is "image" mode; Kie veo3 would still drop the references.
    const mixed = normalized(veo, { medias: [{ role: "start_image", value: "a" }, { role: "image_references", value: "b" }] });
    expect(bindingRejections(veo.bindings.find((b) => b.provider === "kie")!, mixed)).toEqual(["cannot send media role image_references"]);
  });

  it("routes Gemini Omni video references to fal and first/last frames on Veo to Kie", () => {
    const omni = seed("gemini_omni_flash_1_1");
    expect(pick(both, omni, { medias: [{ role: "video_references", value: "v" }] })).toBe("fal google/gemini-omni-flash/v1.1/reference-to-video");
    const veo = seed("veo_3_1");
    expect(pick(both, veo, { medias: [{ role: "start_image", value: "s" }, { role: "end_image", value: "e" }] })).toBe("kie veo3");
  });

  it("explains which provider could serve a request when none of the configured ones can", () => {
    const veo = seed("veo_3_1");
    const error = thrown(() => new ProviderRouter([fal]).route(veo, { request: normalized(veo, { medias: [{ role: "start_image", value: "s" }, { role: "end_image", value: "e" }] }) }));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toMatch(/fal fal-ai\/veo3\.1\/image-to-video: first_last input is not supported/);
    expect(error.message).toMatch(/A key for kie would cover this request\./);
    expect(error.details).toMatchObject({ providers_that_could_serve: ["kie"] });

    const flux = seed("flux_2_max");
    const missing = thrown(() => new ProviderRouter([kie]).route(flux, { request: normalized(flux, {}) }));
    expect(missing.code).toBe("provider_unavailable");
    expect(missing.message).toBe("no configured provider can serve flux_2_max (configured: kie). A key for fal would cover this request.");
  });

  it("prefers bindings that honour the requested tier and only falls back to a pinned one with an adjustment", () => {
    const kling = seed("kling_3_0");
    expect(pick(bothCheapest, kling, { params: { mode: "4k" } })).toBe("kie kling-3.0-omni/text-to-video");
    const falOnly = new ProviderRouter([fal]);
    const request = normalized(kling, { params: { mode: "4k" } });
    const decision = falOnly.route(kling, { request });
    expect(decision.provider.id).toBe("fal");
    const estimate = estimateCost(kling, decision.binding, request);
    expect(estimate?.adjustments).toEqual([expect.objectContaining({ field: "params.mode", from: "4k", to: "pro" })]);

    const grok = seed("grok_image_2");
    expect(pick(bothCheapest, grok, { params: { resolution: "2K" } })).toBe("fal xai/grok-imagine-image/v2.0/text-to-image");
    expect(pick(bothCheapest, grok, { params: { resolution: "1K" } })).toBe("kie grok-imagine-image-2-0/text-to-image");
  });

  it("prefers bindings that render the requested duration (clamps and fixed clip lengths rank later)", () => {
    expect(pick(both, seed("minimax_h3"), { duration: 4 })).toBe("kie minimax-h3/text-to-video");
    expect(pick(both, seed("minimax_h3"), { duration: 6 })).toBe("kie minimax-h3/text-to-video");
    expect(pick(new ProviderRouter([fal, kie], { preference: ["fal", "kie"] }), seed("minimax_h3"), { duration: 4 })).toBe("kie minimax-h3/text-to-video");
    expect(pick(new ProviderRouter([fal, kie], { preference: ["fal", "kie"] }), seed("minimax_h3"), { duration: 6 })).toBe("fal minimax/h3/text-to-video");
    const hailuo = seed("hailuo_2_3");
    const start = [{ role: "start_image" as const, value: "s" }];
    expect(pick(new ProviderRouter([fal, kie], { preference: ["fal", "kie"] }), hailuo, { duration: 10, medias: start, params: { resolution: "768P" } })).toBe("kie hailuo/2-3-image-to-video-pro");
  });

  it("serves count > 1 on single-output providers with a clamp instead of failing", () => {
    const nano = seed("nano_banana_pro");
    const kieOnly = new ProviderRouter([kie]);
    const request = normalized(nano, { count: 2 });
    const decision = kieOnly.route(nano, { request });
    expect(decision.provider.id).toBe("kie");
    expect(estimateCost(nano, decision.binding, request)).toMatchObject({ quantity: 1, adjustments: [expect.objectContaining({ field: "count", from: 2, to: 1, reason: expect.stringMatching(/separate requests/) })] });
    // With a count-capable binding available, that one goes first even though Kie is preferred.
    expect(both.route(nano, { request }).provider.id).toBe("fal");
  });

  it("skips bindings outside their supported values and modes", () => {
    const seedance = seed("seedance_2_5");
    const hf = seedance.bindings.find((b) => b.provider === "higgsfield")!;
    expect(servesRequest(hf, normalized(seedance, { params: { resolution: "720p" } }))).toBe(true);
    expect(bindingRejections(hf, normalized(seedance, { params: { resolution: "1080p" } }))).toEqual(["resolution 1080p is not supported (supports 480p, 720p)"]);
    expect(bindingRejections(hf, normalized(seedance, { medias: [{ role: "start_image", value: "s" }] }))).toEqual(["image input is not supported (supports text)", "cannot send media role start_image"]);
  });
});

describe("ProviderRouter.submit", () => {
  class Stub implements ProviderAdapter {
    readonly calls: SubmitInput[] = [];
    constructor(readonly id: ProviderId, private readonly outcome: StudioError | "ok") {}
    isConfigured(): boolean {
      return true;
    }
    async submit(input: SubmitInput): Promise<SubmitResult> {
      this.calls.push(input);
      if (this.outcome !== "ok") throw this.outcome;
      return { ref: { provider: this.id, providerJobId: `${this.id}_1`, endpoint: input.binding.endpoint }, providerInput: {}, adjustments: [] };
    }
    async getStatus() {
      return { state: "queued" as const };
    }
    async parseWebhook() {
      return { provider: this.id, providerJobId: "", state: "queued" as const, verified: false, raw: null };
    }
  }
  const twoProviders = makeModel({ bindings: [kieBinding(), falBinding()] });
  const input = { request: makeRequest(), medias: [] };

  it("falls back after a definite refusal and records the attempt", async () => {
    const kieStub = new Stub("kie", rejectedSubmit("insufficient_credits", "no credits"));
    const falStub = new Stub("fal", "ok");
    const result = await new ProviderRouter([kieStub, falStub]).submit(twoProviders, { ...input, webhookUrl: (id) => `https://hooks.test/${id}` });
    expect(result.provider).toBe(falStub);
    expect(result.ref.providerJobId).toBe("fal_1");
    expect(result.attempts).toEqual([{ provider: "kie", endpoint: "fixture/image", error: expect.objectContaining({ code: "insufficient_credits" }) }]);
    expect(falStub.calls[0]?.webhookUrl).toBe("https://hooks.test/fal");
  });

  it("never submits elsewhere after an ambiguous error (the first job may be billed)", async () => {
    const kieStub = new Stub("kie", ambiguousSubmit("provider_unavailable", "gateway timeout"));
    const falStub = new Stub("fal", "ok");
    const error = await rejection(new ProviderRouter([kieStub, falStub]).submit(twoProviders, input));
    expect(error.submissionOutcome).toBe("unknown");
    expect(falStub.calls).toHaveLength(0);
  });

  it("stops on invalid input and on untagged errors, and rethrows the last refusal when every candidate refuses", async () => {
    const invalid = new Stub("kie", new StudioError("invalid_request", "bad prompt"));
    const falStub = new Stub("fal", "ok");
    expect((await rejection(new ProviderRouter([invalid, falStub]).submit(twoProviders, input))).code).toBe("invalid_request");
    const untagged = new Stub("kie", new StudioError("provider_error", "weird"));
    await rejection(new ProviderRouter([untagged, falStub]).submit(twoProviders, input));
    expect(falStub.calls).toHaveLength(0);

    const a = new Stub("kie", rejectedSubmit("unauthorized", "bad key"));
    const b = new Stub("fal", rejectedSubmit("provider_rate_limited", "slow down"));
    expect((await rejection(new ProviderRouter([a, b]).submit(twoProviders, input))).code).toBe("provider_rate_limited");
  });
});
