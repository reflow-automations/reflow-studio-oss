import type { ModelDefinition, Pricing, ProviderBinding } from "../catalog/types";
import type { Adjustment, NormalizedRequest } from "../jobs/types";
import { effectiveRequest } from "../catalog/mapping";
import { dimensionsFor, megapixels } from "../util/aspect";

export interface CostEstimate {
  usd: number;
  currency: "USD";
  unit: Pricing["unit"];
  quantity: number;
  unitPriceUsd: number;
  /** Human-readable explanation. */
  breakdown: string;
  verified: boolean;
  provider: ProviderBinding["provider"];
  endpoint: string;
  /**
   * Binding-level adjustments the estimate (and the submitted body) already
   * reflect: clamped duration, one output per job, a pinned tier. Empty when
   * the binding serves the request exactly as asked.
   */
  adjustments?: Adjustment[];
}

/**
 * Estimate the cost of a normalised request for a given binding. This is a
 * *pre-flight* estimate (like Higgsfield's `get_cost:true`): providers may
 * bill slightly differently (input megapixels, audio surcharges, rounding).
 * The request is first narrowed to what the binding will actually run
 * (`effectiveRequest`), so a clamped duration or a single-output endpoint is
 * priced as sent.
 */
export function estimateCost(model: ModelDefinition, binding: ProviderBinding, request: NormalizedRequest): CostEstimate | undefined {
  const pricing = binding.pricing;
  if (!pricing) return undefined;
  const { request: effective, adjustments } = effectiveRequest(model, binding, request);
  const unitPrice = resolveUnitPrice(pricing, effective);
  const count = effective.count;
  const scale = scaleFactor(pricing, effective.params);
  let quantity: number;
  let explanation: string;
  let usd: number | undefined;
  switch (pricing.unit) {
    case "image":
    case "generation":
      quantity = count;
      explanation = `${count} × $${unitPrice.toFixed(4)} per ${pricing.unit}`;
      break;
    case "megapixel": {
      const tier = resolutionTier(effective.params);
      const mp = round3(megapixels(dimensionsFor(effective.aspect_ratio ?? "1:1", tier)) * scale);
      quantity = mp * count;
      const scaleNote = pricing.scale_param && scale !== 1 ? ` (${pricing.scale_param.name} ${String(effective.params[pricing.scale_param.name])}, assuming a ~1 MP source)` : "";
      if (pricing.first_unit_usd !== undefined) {
        const perOutput = pricing.first_unit_usd + Math.max(0, mp - 1) * unitPrice;
        usd = round(perOutput * count);
        explanation = `${count} × (first MP $${pricing.first_unit_usd.toFixed(4)} + ${round3(Math.max(0, mp - 1))} MP × $${unitPrice.toFixed(4)})${scaleNote}`;
      } else {
        explanation = `${count} × ${mp} MP × $${unitPrice.toFixed(4)} per MP${scaleNote}`;
      }
      break;
    }
    case "second": {
      const seconds = effective.duration ?? model.default_duration ?? model.durations?.[0] ?? model.duration_range?.min ?? 5;
      quantity = seconds * count * scale;
      explanation = `${count} × ${seconds}s × $${unitPrice.toFixed(4)} per second`;
      break;
    }
    case "minute": {
      const seconds = effective.duration ?? model.default_duration ?? model.durations?.[0] ?? model.duration_range?.min ?? 60;
      quantity = (seconds / 60) * count * scale;
      explanation = `${count} × ${(seconds / 60).toFixed(2)} min × $${unitPrice.toFixed(4)} per minute`;
      break;
    }
    case "thousand_chars": {
      const chars = effective.prompt?.length ?? 0;
      quantity = (Math.ceil(chars / 1000) || 1) * count;
      explanation = `${count} × ${Math.ceil(chars / 1000) || 1}k chars × $${unitPrice.toFixed(4)} per 1k chars`;
      break;
    }
    default:
      quantity = count;
      explanation = `${count} × $${unitPrice.toFixed(4)}`;
  }
  usd ??= round(unitPrice * quantity);
  const notes = [pricing.notes, pricing.input_dependent ? "output length follows the input media; the duration is only a hint" : undefined].filter(Boolean).join("; ");
  return {
    usd,
    currency: "USD",
    unit: pricing.unit,
    quantity,
    unitPriceUsd: unitPrice,
    breakdown: `${explanation} = $${usd.toFixed(4)}${notes ? ` (${notes})` : ""}`,
    verified: (pricing.verified ?? false) && !pricing.input_dependent,
    provider: binding.provider,
    endpoint: binding.endpoint,
    ...(adjustments.length > 0 ? { adjustments } : {}),
  };
}

/** First modifier whose conditions all hold wins. Conditions may key on params or on duration / aspect_ratio / count. */
function resolveUnitPrice(pricing: Pricing, request: NormalizedRequest): number {
  const context: Record<string, unknown> = { duration: request.duration, aspect_ratio: request.aspect_ratio, count: request.count, ...request.params };
  for (const modifier of pricing.modifiers ?? []) {
    const matches = Object.entries(modifier.when).every(([key, value]) => String(context[key]) === String(value));
    if (matches) return modifier.usd;
  }
  return pricing.usd;
}

function scaleFactor(pricing: Pricing, params: Record<string, unknown>): number {
  if (!pricing.scale_param) return 1;
  const raw = Number(params[pricing.scale_param.name]);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return raw ** (pricing.scale_param.exponent ?? 1);
}

function resolutionTier(params: Record<string, unknown>): "1k" | "2k" | "4k" {
  const raw = String(params.resolution ?? params.quality ?? "1k").toLowerCase();
  if (raw.startsWith("4")) return "4k";
  if (raw.startsWith("2") || raw === "high") return "2k";
  return "1k";
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
