import type { ModelDefinition, ModelParameter } from "./types";
import type { Adjustment, GenerateRequest, MediaInput, NormalizedRequest } from "../jobs/types";
import { nearestAspectRatio } from "../util/aspect";
import { StudioError } from "../util/errors";

const DEFAULT_MAX_COUNT = 4;

/**
 * Validate a generation request against the catalog definition and coerce it
 * into a canonical form. Non-fatal fixes (clamped duration, nearest aspect
 * ratio, defaulted parameters) are reported as `adjustments`, mirroring the
 * behaviour of Higgsfield's MCP. Fatal problems throw `StudioError`.
 */
export function normalizeRequest(model: ModelDefinition, request: GenerateRequest): NormalizedRequest {
  const adjustments: Adjustment[] = [];
  const errors: string[] = [];

  // Prompt
  if (request.prompt !== undefined && request.prompt !== null && typeof request.prompt !== "string") errors.push("prompt must be a string");
  if (request.negative_prompt !== undefined && request.negative_prompt !== null && typeof request.negative_prompt !== "string") errors.push("negative_prompt must be a string");
  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : undefined;
  const negativePrompt = typeof request.negative_prompt === "string" ? request.negative_prompt.trim() || undefined : undefined;
  const requiresPrompt = model.capabilities.some((c) => c.startsWith("text-to")) && !model.medias.some((m) => m.required);
  if (requiresPrompt && !prompt) errors.push("prompt is required for this model");

  // Count
  const maxCount = model.max_count ?? DEFAULT_MAX_COUNT;
  let count = 1;
  if (typeof request.count === "number" && Number.isFinite(request.count)) {
    count = Math.round(request.count);
    if (count !== request.count) adjustments.push({ field: "count", from: request.count, to: count, reason: "count must be an integer" });
  }
  if (count < 1) {
    adjustments.push({ field: "count", from: request.count, to: 1, reason: "count must be at least 1" });
    count = 1;
  } else if (count > maxCount) {
    adjustments.push({ field: "count", from: request.count, to: maxCount, reason: `count capped at ${maxCount} for ${model.id}` });
    count = maxCount;
  }

  // Aspect ratio
  if (request.aspect_ratio !== undefined && request.aspect_ratio !== null && typeof request.aspect_ratio !== "string") errors.push("aspect_ratio must be a string such as 16:9");
  let aspectRatio = typeof request.aspect_ratio === "string" ? request.aspect_ratio.trim() || undefined : undefined;
  if (model.aspect_ratios.length > 0) {
    if (!aspectRatio) {
      aspectRatio = model.aspect_ratios[0];
    } else if (!model.aspect_ratios.includes(aspectRatio)) {
      const nearest = nearestAspectRatio(aspectRatio, model.aspect_ratios) ?? model.aspect_ratios[0];
      adjustments.push({ field: "aspect_ratio", from: aspectRatio, to: nearest, reason: `${model.id} does not support ${aspectRatio}` });
      aspectRatio = nearest;
    }
  } else if (aspectRatio) {
    adjustments.push({ field: "aspect_ratio", from: aspectRatio, to: undefined, reason: `${model.id} ignores aspect_ratio` });
    aspectRatio = undefined;
  }

  // Duration
  let duration = request.duration === null ? undefined : request.duration;
  if (duration !== undefined && (typeof duration !== "number" || !Number.isFinite(duration))) {
    errors.push("duration must be a finite number of seconds");
    duration = undefined;
  }
  const supportsDuration = model.durations !== undefined || model.duration_range !== undefined;
  if (supportsDuration) {
    if (duration === undefined) {
      duration = model.default_duration ?? model.durations?.[0] ?? model.duration_range?.min;
    } else if (model.durations && model.durations.length > 0 && !model.durations.includes(duration)) {
      const nearest = model.durations.reduce((best, d) => (Math.abs(d - duration!) < Math.abs(best - duration!) ? d : best));
      adjustments.push({ field: "duration", from: duration, to: nearest, reason: `${model.id} supports durations ${model.durations.join(", ")}` });
      duration = nearest;
    } else if (model.duration_range) {
      const clamped = Math.min(model.duration_range.max, Math.max(model.duration_range.min, Math.round(duration)));
      if (clamped !== duration) {
        adjustments.push({ field: "duration", from: duration, to: clamped, reason: `${model.id} supports ${model.duration_range.min}-${model.duration_range.max}s` });
        duration = clamped;
      }
    }
  } else if (duration !== undefined) {
    adjustments.push({ field: "duration", from: duration, to: undefined, reason: `${model.id} ignores duration` });
    duration = undefined;
  }

  // Medias
  const medias: MediaInput[] = [];
  const allowedRoles = new Map(model.medias.map((slot) => [slot.role, slot] as const));
  if (request.medias !== undefined && request.medias !== null && !Array.isArray(request.medias)) errors.push("medias must be an array of { role, value }");
  for (const media of Array.isArray(request.medias) ? request.medias : []) {
    if (!media || typeof media.value !== "string" || media.value.trim() === "") {
      errors.push("each media needs a non-empty value");
      continue;
    }
    const slot = allowedRoles.get(media.role);
    if (!slot) {
      // Auto-coerce the most common confusion: a single "image" where the model wants references (and vice versa).
      const fallback = media.role === "image" ? allowedRoles.get("image_references") : media.role === "image_references" ? allowedRoles.get("image") : undefined;
      if (fallback) {
        adjustments.push({ field: "medias.role", from: media.role, to: fallback.role, reason: `${model.id} uses role ${fallback.role}` });
        medias.push({ role: fallback.role, value: media.value });
        continue;
      }
      errors.push(`media role ${media.role} is not supported by ${model.id} (supported: ${[...allowedRoles.keys()].join(", ") || "none"})`);
      continue;
    }
    medias.push({ role: media.role, value: media.value });
  }
  for (const slot of model.medias) {
    const provided = medias.filter((m) => m.role === slot.role).length;
    if (slot.required && provided === 0) errors.push(`media role ${slot.role} is required for ${model.id}`);
    const max = slot.max ?? 1;
    if (provided > max) errors.push(`at most ${max} media item(s) allowed for role ${slot.role}`);
    if (slot.requires && provided > 0 && !medias.some((m) => m.role === slot.requires)) errors.push(`media role ${slot.role} requires ${slot.requires}`);
  }

  // Parameters
  const params: Record<string, unknown> = {};
  const known = new Map(model.parameters.map((p) => [p.name, p] as const));
  const rawParams: unknown = request.params ?? {};
  const isObject = typeof rawParams === "object" && rawParams !== null && !Array.isArray(rawParams);
  if (!isObject) errors.push("params must be an object");
  const provided = isObject ? (rawParams as Record<string, unknown>) : {};
  for (const [name, value] of Object.entries(provided)) {
    if (value === undefined || value === null) continue;
    const def = known.get(name);
    if (!def) {
      adjustments.push({ field: `params.${name}`, from: value, to: undefined, reason: `unknown parameter for ${model.id}; ignored` });
      continue;
    }
    const coerced = coerceParameter(def, value, adjustments, errors);
    if (coerced !== undefined) params[name] = coerced;
  }
  for (const def of model.parameters) {
    if (params[def.name] !== undefined) continue;
    if (def.default !== undefined) params[def.name] = def.default;
    else if (def.required) errors.push(`parameter ${def.name} is required for ${model.id}`);
  }
  const allowedResolutions = aspectRatio ? model.aspect_ratio_resolution_limits?.[aspectRatio] : undefined;
  if (allowedResolutions?.length && typeof params.resolution === "string" && !allowedResolutions.includes(params.resolution)) {
    const old = params.resolution;
    params.resolution = allowedResolutions[0];
    adjustments.push({ field: "params.resolution", from: old, to: allowedResolutions[0], reason: `${aspectRatio} only supports ${allowedResolutions.join(", ")} on ${model.id}` });
  }

  if (errors.length > 0) {
    throw new StudioError("invalid_request", errors.join("; "), { details: { errors, adjustments } });
  }

  return {
    model: model.id,
    prompt,
    negative_prompt: negativePrompt,
    aspect_ratio: aspectRatio,
    duration,
    count,
    medias,
    params,
    adjustments,
  };
}

function coerceParameter(def: ModelParameter, value: unknown, adjustments: Adjustment[], errors: string[]): unknown {
  const field = `params.${def.name}`;
  switch (def.type) {
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      errors.push(`${field} must be a boolean`);
      return undefined;
    }
    case "number":
    case "integer": {
      // Only real numbers or numeric strings: Number("") is 0 and Number(true) is 1.
      const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
      if (!Number.isFinite(num)) {
        errors.push(`${field} must be a number`);
        return undefined;
      }
      let result = def.type === "integer" ? Math.round(num) : num;
      if (def.options && !def.options.includes(result)) {
        const nearest = (def.options as number[]).reduce((best, o) => (Math.abs(o - result) < Math.abs(best - result) ? o : best));
        adjustments.push({ field, from: result, to: nearest, reason: `allowed values: ${def.options.join(", ")}` });
        result = nearest;
      }
      if (def.min !== undefined && result < def.min) {
        adjustments.push({ field, from: result, to: def.min, reason: `minimum is ${def.min}` });
        result = def.min;
      }
      if (def.max !== undefined && result > def.max) {
        adjustments.push({ field, from: result, to: def.max, reason: `maximum is ${def.max}` });
        result = def.max;
      }
      return result;
    }
    case "string": {
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        errors.push(`${field} must be a string`);
        return undefined;
      }
      const str = typeof value === "string" ? value : String(value);
      if (def.options && !def.options.includes(str)) {
        const lower = (def.options as string[]).find((o) => o.toLowerCase() === str.toLowerCase());
        if (lower) {
          adjustments.push({ field, from: str, to: lower, reason: "normalised case" });
          return lower;
        }
        errors.push(`${field} must be one of ${def.options.join(", ")}`);
        return undefined;
      }
      return str;
    }
    case "string_array": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        errors.push(`${field} must be an array of strings`);
        return undefined;
      }
      if (def.max !== undefined && value.length > def.max) {
        adjustments.push({ field, from: value.length, to: def.max, reason: `at most ${def.max} items` });
        return value.slice(0, def.max);
      }
      return value;
    }
    case "object": {
      if (value === null || typeof value !== "object") {
        errors.push(`${field} must be an object`);
        return undefined;
      }
      return value;
    }
    default:
      return value;
  }
}
