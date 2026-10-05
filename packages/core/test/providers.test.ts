import { describe, expect, it } from "vitest";
import { isPaidProviderId, isProviderId, PAID_PROVIDER_IDS, PROVIDER_IDS, toPublicModel } from "../src/catalog/types";
import { listProviderInfo, PROVIDER_INFO } from "../src/providers/info";
import { KIE_USD_PER_CREDIT } from "../src/providers/kie/index";
import { SEED_MODELS } from "../src/catalog/models/index";

describe("provider ids", () => {
  it("has one source of truth: paid ids are every id except the offline mock", () => {
    expect(PAID_PROVIDER_IDS).toEqual(PROVIDER_IDS.filter((id) => id !== "mock"));
    expect(PROVIDER_IDS.every(isProviderId)).toBe(true);
    expect(isProviderId("replicate")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
    expect(isPaidProviderId("mock")).toBe(false);
    expect(isPaidProviderId("kie")).toBe(true);
  });

  it("describes every provider id, with the paid flag matching PAID_PROVIDER_IDS", () => {
    expect(listProviderInfo().map((info) => info.id)).toEqual([...PROVIDER_IDS]);
    for (const id of PROVIDER_IDS) {
      const info = PROVIDER_INFO[id];
      expect(info.id).toBe(id);
      expect(info.paid, id).toBe(isPaidProviderId(id));
      if (info.paid) {
        expect(info.envVar, id).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(info.keyUrl, id).toMatch(/^https:\/\//);
      }
    }
    expect(PROVIDER_INFO.kie.nativeUnit).toEqual({ unit: "credits", usdPerUnit: KIE_USD_PER_CREDIT });
    expect(PROVIDER_INFO.higgsfield.estimateSettles).toBe(false);
  });

  it("only binds catalog models to known providers", () => {
    for (const model of SEED_MODELS) for (const binding of model.bindings) expect(isProviderId(binding.provider), `${model.id}`).toBe(true);
  });
});

describe("toPublicModel", () => {
  it("shows API/MCP clients the binding limits that decide routing", () => {
    const seedance = toPublicModel(SEED_MODELS.find((m) => m.id === "seedance_2_5")!);
    expect(seedance.providers.find((p) => p.provider === "higgsfield")).toMatchObject({ supportedModes: ["text"], supportedParamValues: { resolution: ["480p", "720p"], return_last_frame: [false] } });
    const veo = toPublicModel(SEED_MODELS.find((m) => m.id === "veo_3_1")!);
    expect(veo.providers.find((p) => p.provider === "kie")).toMatchObject({ fixedDuration: 8, pinnedParams: { generate_audio: true }, supportedModes: ["text", "image", "first_last"] });
    expect(veo.providers.find((p) => p.provider === "fal")).not.toHaveProperty("fixedDuration");
    expect(veo).not.toHaveProperty("bindings");
  });
});
