import type { EndpointMode, InputMappingSpec, MediaRole, ModelDefinition, OutputMappingSpec, ProviderBinding } from "./types";
import type { Adjustment, MediaInput, NormalizedRequest, ProviderOutput, ResolvedMedia } from "../jobs/types";
import { parseAspectRatio } from "../util/aspect";
import { getFirst, getPath, setPath } from "../util/path";

/**
 * A request as one specific binding will execute it. `normalizeRequest`
 * validates against the *model*; bindings can be narrower (a duration clamp,
 * one output per job, an endpoint pinned to one tier, a size preset that only
 * approximates the ratio). Everything that differs is reported here so the
 * body that is sent, the cost estimate and the adjustments shown to the user
 * always agree.
 */
export interface EffectiveRequest {
  /** Request with binding-level changes applied (clamped duration/count, pinned params, ignored params removed). */
  request: NormalizedRequest;
  /** Binding-level adjustments (in addition to the model-level `request.adjustments`). */
  adjustments: Adjustment[];
  /** Input mode used for endpoint and mapping selection. */
  mode: EndpointMode;
  /** Input mapping resolved for `mode`. */
  spec: InputMappingSpec;
  /**
   * False when the binding changes what the user gets (pinned tier, fewer
   * outputs, clamped or fixed duration, dropped media). The router ranks exact
   * bindings first.
   */
  exact: boolean;
}

/**
 * Apply a binding's constraints to a normalised request. `medias` overrides
 * the roles taken from `request.medias` (adapters pass the resolved media).
 */
export function effectiveRequest(
  model: ModelDefinition,
  binding: ProviderBinding,
  request: NormalizedRequest,
  medias: ReadonlyArray<{ role: MediaRole }> = request.medias,
): EffectiveRequest {
  const adjustments: Adjustment[] = [];
  let exact = true;

  // Media roles the binding drops on purpose.
  const ignored = new Set(binding.ignoredRoles ?? []);
  const keptRoles = medias.filter((m) => !ignored.has(m.role));
  const label = `${binding.provider} ${resolveEndpoint(binding, keptRoles)}`;
  for (const role of new Set(medias.filter((m) => ignored.has(m.role)).map((m) => m.role))) {
    adjustments.push({ field: `medias.${role}`, from: medias.filter((m) => m.role === role).length, to: 0, reason: `${label} does not use ${role}; it is not sent` });
    exact = false;
  }
  const mode = resolveEndpointMode(keptRoles);
  const spec = resolveInputSpec(binding.input, mode);
  const keptMedias: MediaInput[] = request.medias.filter((m) => !ignored.has(m.role));

  // Parameters: pinned tiers first, then fields the endpoint does not have.
  const params: Record<string, unknown> = { ...request.params };
  const pinned = binding.pinnedParams ?? {};
  for (const [name, value] of Object.entries(pinned)) {
    if (params[name] === undefined || params[name] === value) continue;
    adjustments.push({ field: `params.${name}`, from: params[name], to: value, reason: `${label} always renders ${name} ${String(value)}` });
    params[name] = value;
    exact = false;
  }
  const paramSpecs = spec.params ?? {};
  const defaults = new Map(model.parameters.map((p) => [p.name, p.default] as const));
  for (const [name, value] of Object.entries(request.params)) {
    if (value === undefined || name in pinned) continue;
    const paramSpec = paramSpecs[name];
    const dropped = paramSpec === undefined ? Boolean(spec.strictParams) : typeof paramSpec === "object" && Boolean(paramSpec.omit);
    if (!dropped) continue;
    delete params[name];
    const def = defaults.get(name);
    // Defaults the endpoint does not take are not news; explicit values are.
    if (def === undefined || !sameValue(def, value)) adjustments.push({ field: `params.${name}`, from: value, to: undefined, reason: `${label} has no ${name} setting; ignored` });
  }

  // Duration.
  let duration = request.duration;
  if (spec.duration === null) {
    if (binding.fixedDuration !== undefined) {
      if (duration !== undefined && duration !== binding.fixedDuration) {
        adjustments.push({ field: "duration", from: duration, to: binding.fixedDuration, reason: `${label} always renders ${binding.fixedDuration} s clips` });
        exact = false;
      }
      duration = binding.fixedDuration;
    }
  } else if (duration !== undefined) {
    const d = spec.duration;
    let clamped = duration;
    if (d?.min !== undefined) clamped = Math.max(d.min, clamped);
    if (d?.max !== undefined) clamped = Math.min(d.max, clamped);
    if (clamped !== duration) {
      const range = d?.min !== undefined && d?.max !== undefined ? `${d.min}-${d.max} s` : d?.min !== undefined ? `at least ${d.min} s` : `at most ${d?.max} s`;
      adjustments.push({ field: "duration", from: duration, to: clamped, reason: `${label} supports ${range}${mode === "text" ? "" : ` in ${mode} mode`}` });
      duration = clamped;
      exact = false;
    }
  }

  // Number of outputs.
  let count = request.count;
  if (count > 1) {
    if (!spec.count) {
      adjustments.push({ field: "count", from: count, to: 1, reason: `${label} returns one output per job; send ${count} separate requests (or use a provider that supports count) for more variants` });
      count = 1;
      exact = false;
    } else if (spec.count.max !== undefined && count > spec.count.max) {
      adjustments.push({ field: "count", from: count, to: spec.count.max, reason: `${label} returns at most ${spec.count.max} outputs per job` });
      count = spec.count.max;
      exact = false;
    }
  }

  // Size presets that only approximate the ratio.
  let aspectRatio = request.aspect_ratio;
  const ar = spec.aspect_ratio;
  if (aspectRatio !== undefined && ar && "size_field" in ar) {
    const size = ar.sizes[aspectRatio];
    const rendered = ar.rendered?.[aspectRatio] ?? (size !== undefined && typeof size === "object" ? renderedRatio(aspectRatio, size) : undefined);
    if (size !== undefined && rendered !== undefined && rendered !== aspectRatio) {
      adjustments.push({ field: "aspect_ratio", from: aspectRatio, to: rendered, reason: `${label} renders ${aspectRatio} with the closest size preset (${rendered})` });
      exact = false;
      // Only switch when the body stays identical, so the estimate follows the real output size.
      if (sameValue(ar.sizes[rendered], size)) aspectRatio = rendered;
    }
  }

  return {
    request: { ...request, aspect_ratio: aspectRatio, duration, count, params, medias: keptMedias },
    adjustments,
    mode,
    spec,
    exact,
  };
}

/** Everything an adapter needs to submit: endpoint, body and the binding-level adjustments. */
export interface PreparedProviderRequest {
  endpoint: string;
  body: Record<string, unknown>;
  request: NormalizedRequest;
  medias: ResolvedMedia[];
  adjustments: Adjustment[];
  mode: EndpointMode;
}

/** Resolve the endpoint and build the provider body for a submit (shared by every adapter). */
export function prepareProviderRequest(input: { model: ModelDefinition; binding: ProviderBinding; request: NormalizedRequest; medias: ResolvedMedia[] }): PreparedProviderRequest {
  const effective = effectiveRequest(input.model, input.binding, input.request, input.medias);
  const ignored = new Set(input.binding.ignoredRoles ?? []);
  const medias = input.medias.filter((m) => !ignored.has(m.role));
  return {
    endpoint: resolveEndpoint(input.binding, medias),
    body: writeBody(effective, medias),
    request: effective.request,
    medias,
    adjustments: effective.adjustments,
    mode: effective.mode,
  };
}

/**
 * Build the provider request body from a normalised request using the
 * binding's declarative input mapping. Per-mode overrides (`byMode`) are
 * resolved from the media roles that are present, mirroring `resolveEndpoint`.
 * Binding-level constraints are applied through `effectiveRequest`.
 */
export function buildProviderInput(
  model: ModelDefinition,
  binding: ProviderBinding,
  request: NormalizedRequest,
  medias: ResolvedMedia[],
): Record<string, unknown> {
  return prepareProviderRequest({ model, binding, request, medias }).body;
}

function writeBody(effective: EffectiveRequest, medias: ResolvedMedia[]): Record<string, unknown> {
  const { spec, request } = effective;
  const body: Record<string, unknown> = {};

  if (spec.constants) {
    for (const [key, value] of Object.entries(spec.constants)) setPath(body, key, value);
  }

  const promptField = spec.prompt === undefined ? "prompt" : spec.prompt;
  if (promptField && request.prompt !== undefined) setPath(body, promptField, request.prompt);

  const negativeField = spec.negative_prompt === undefined ? null : spec.negative_prompt;
  if (negativeField && request.negative_prompt !== undefined) setPath(body, negativeField, request.negative_prompt);

  if (request.aspect_ratio !== undefined && spec.aspect_ratio !== null) {
    const ar = spec.aspect_ratio ?? { field: "aspect_ratio" };
    if ("field" in ar) {
      const value = ar.values?.[request.aspect_ratio] ?? request.aspect_ratio;
      setPath(body, ar.field, value);
    } else {
      const size = ar.sizes[request.aspect_ratio];
      if (size !== undefined) setPath(body, ar.size_field, size);
    }
  }

  if (request.duration !== undefined && spec.duration !== null) {
    const d = spec.duration ?? { field: "duration", format: "number" as const };
    const format = d.format ?? "number";
    const seconds = request.duration;
    const value = format === "number" ? seconds : format === "string" ? String(seconds) : `${seconds}s`;
    setPath(body, d.field, value);
  }

  if (spec.count && request.count > 1) setPath(body, spec.count.field, request.count);

  if (spec.roles) {
    const byRole = new Map<string, ResolvedMedia[]>();
    for (const media of medias) {
      const list = byRole.get(media.role) ?? [];
      list.push(media);
      byRole.set(media.role, list);
    }
    for (const [role, field] of Object.entries(spec.roles)) {
      if (!field) continue;
      const items = byRole.get(role);
      if (!items || items.length === 0) continue;
      if (field.endsWith("[]")) {
        setPath(body, field, items.map((m) => m.url));
      } else {
        const first = items[0];
        if (first) setPath(body, field, first.url);
      }
    }
  }

  const paramSpecs = spec.params ?? {};
  for (const [name, rawValue] of Object.entries(request.params)) {
    if (rawValue === undefined) continue;
    const paramSpec = paramSpecs[name];
    if (paramSpec === undefined) {
      if (spec.strictParams) continue;
      setPath(body, name, rawValue);
      continue;
    }
    if (typeof paramSpec === "string") {
      setPath(body, paramSpec, rawValue);
      continue;
    }
    if (paramSpec.omit) continue;
    const translated = paramSpec.values && typeof rawValue !== "object" ? (paramSpec.values[String(rawValue)] ?? rawValue) : rawValue;
    setPath(body, paramSpec.field, translated);
  }

  return body;
}

/**
 * Apply the `byMode` override for an input mode to a mapping spec. Modes fall
 * back the same way endpoints do (`first_last` -> `image`); a spec without an
 * entry for the mode is returned untouched.
 */
export function resolveInputSpec(spec: InputMappingSpec, mode: EndpointMode): InputMappingSpec {
  const byMode = spec.byMode;
  if (!byMode) return spec;
  const override = mode === "first_last" ? (byMode.first_last ?? byMode.image) : byMode[mode];
  if (!override) return spec;
  const { byMode: _byMode, ...base } = spec;
  const merged: InputMappingSpec = { ...base };
  if ("prompt" in override) merged.prompt = override.prompt;
  if ("negative_prompt" in override) merged.negative_prompt = override.negative_prompt;
  if ("aspect_ratio" in override) merged.aspect_ratio = override.aspect_ratio;
  if ("duration" in override) merged.duration = override.duration;
  if ("count" in override) merged.count = override.count;
  if (override.constants) merged.constants = { ...base.constants, ...override.constants };
  if (override.params) merged.params = { ...base.params, ...override.params };
  return merged;
}

/**
 * Derive the input mode of a request from the media roles that are present.
 * Works on both `MediaInput` (pre-resolution) and `ResolvedMedia` lists.
 */
export function resolveEndpointMode(medias: ReadonlyArray<{ role: MediaRole }>): EndpointMode {
  const roles = new Set(medias.map((m) => m.role));
  if (roles.has("start_image") && roles.has("end_image")) return "first_last";
  if (roles.has("start_image")) return "image";
  if (roles.size > 0) return "reference";
  return "text";
}

/**
 * Pick the provider endpoint for a binding given the medias of the request.
 * Bindings without `endpointByMode` always use `endpoint`; otherwise the entry
 * for the resolved mode is used, falling back along
 * first_last -> image -> endpoint, reference -> endpoint and text -> endpoint.
 */
export function resolveEndpoint(binding: ProviderBinding, medias: ReadonlyArray<{ role: MediaRole }>): string {
  const byMode = binding.endpointByMode;
  if (!byMode) return binding.endpoint;
  switch (resolveEndpointMode(medias)) {
    case "first_last":
      return byMode.first_last ?? byMode.image ?? binding.endpoint;
    case "image":
      return byMode.image ?? binding.endpoint;
    case "reference":
      return byMode.reference ?? binding.endpoint;
    default:
      return byMode.text ?? binding.endpoint;
  }
}

/**
 * Media roles in the request that a binding can neither map nor deliberately
 * ignore. A non-empty result means the binding would silently drop reference
 * media, so the router does not use it.
 */
export function unmappedRoles(binding: ProviderBinding, medias: ReadonlyArray<{ role: MediaRole }>): MediaRole[] {
  const ignored = new Set(binding.ignoredRoles ?? []);
  const kept = medias.filter((m) => !ignored.has(m.role));
  const roles = resolveInputSpec(binding.input, resolveEndpointMode(kept)).roles ?? {};
  return [...new Set(kept.map((m) => m.role))].filter((role) => !roles[role]);
}

/** Read provider outputs from a raw result payload using the binding's output mapping. */
export function extractOutputs(spec: OutputMappingSpec, payload: unknown): ProviderOutput[] {
  const outputs: ProviderOutput[] = [];
  for (const rule of spec.outputs) {
    const seed = spec.seed_path ? toNumber(getFirst(payload, spec.seed_path)) : undefined;
    for (const item of getPath(payload, rule.path)) {
      if (typeof item === "string") {
        if (isFetchableUrl(item)) outputs.push({ kind: rule.kind, url: item, seed });
        continue;
      }
      if (item === null || typeof item !== "object") continue;
      const url = getFirst<string>(item, rule.url_path ?? "url");
      if (typeof url !== "string" || !isFetchableUrl(url)) continue;
      const output: ProviderOutput = { kind: rule.kind, url };
      const contentType = getFirst<string>(item, rule.content_type_path ?? "content_type");
      if (typeof contentType === "string") output.content_type = contentType;
      const width = toNumber(getFirst(item, rule.width_path ?? "width"));
      const height = toNumber(getFirst(item, rule.height_path ?? "height"));
      if (width !== undefined) output.width = width;
      if (height !== undefined) output.height = height;
      const duration = toNumber(getFirst(item, rule.duration_path ?? "duration"));
      if (duration !== undefined) output.duration_seconds = duration;
      if (seed !== undefined) output.seed = seed;
      outputs.push(output);
    }
  }
  return outputs;
}

/** Provider-reported cost (if the mapping declares one). */
export function extractReportedCost(spec: OutputMappingSpec, payload: unknown): number | undefined {
  if (!spec.cost_path) return undefined;
  return toNumber(getFirst(payload, spec.cost_path));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** http(s) URLs plus inline `data:` URLs (fal `sync_mode`, the offline mock). Hosts must decode data URLs locally. */
export function isFetchableUrl(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://") || value.startsWith("data:");
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The "w:h" ratio a fixed {width,height} box renders when it differs from the requested ratio by more than 1%. */
function renderedRatio(requested: string, size: { width: number; height: number }): string | undefined {
  const target = parseAspectRatio(requested);
  if (target === undefined || size.height <= 0 || size.width <= 0) return undefined;
  if (Math.abs(Math.log(size.width / size.height) - Math.log(target)) < 0.01) return undefined;
  const g = gcd(Math.round(size.width), Math.round(size.height)) || 1;
  return `${Math.round(size.width) / g}:${Math.round(size.height) / g}`;
}
