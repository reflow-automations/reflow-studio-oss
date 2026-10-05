import type { MediaRole, ModelDefinition, ProviderBinding } from "../../catalog/types";

/** Pricing note on every synthesized mock binding (shown in cost breakdowns). */
export const MOCK_PROVIDER_NOTE = "offline mock provider: placeholder media, no real cost";

/**
 * A binding that lets the offline mock serve `model` in every input mode the
 * model declares: all media roles are mapped, parameters pass through, the
 * duration and count follow the model's own limits, and the price is zero.
 * It is a `lastResort` binding, so a configured paid provider always wins.
 */
export function mockBindingFor(model: ModelDefinition): ProviderBinding {
  const roles: Partial<Record<MediaRole, string>> = {};
  for (const slot of model.medias) roles[slot.role] = `${slot.role}[]`;
  const hasDuration = model.durations !== undefined || model.duration_range !== undefined;
  const maxCount = model.max_count ?? 4;
  return {
    provider: "mock",
    endpoint: `mock/${model.id}`,
    input: {
      negative_prompt: "negative_prompt",
      aspect_ratio: model.aspect_ratios.length > 0 ? { field: "aspect_ratio" } : null,
      duration: hasDuration ? { field: "duration" } : null,
      count: maxCount > 1 ? { field: "count", max: maxCount } : null,
      roles,
    },
    // The mock builds its outputs itself; this mapping only reads webhook payloads posted by hand.
    output: { outputs: [{ path: "images[]", kind: "image" }, { path: "video", kind: "video" }] },
    pricing: { unit: "generation", usd: 0, notes: MOCK_PROVIDER_NOTE, verified: true },
    priority: 1000,
    lastResort: true,
    notes: "Synthesized offline mock binding: serves every mode the model declares with placeholder media.",
    verified: true,
  };
}

/**
 * Append a mock binding to every model (models that already have one are
 * left alone). Use it for the registry when the mock provider is enabled, so
 * every catalog model can run without provider keys.
 */
export function withMockBindings(models: readonly ModelDefinition[]): ModelDefinition[] {
  return models.map((model) => (model.bindings.some((b) => b.provider === "mock") ? model : { ...model, bindings: [...model.bindings, mockBindingFor(model)] }));
}
