import type { MediaRole, PublicModel } from "@reflow/core";
import type { GenerateBody, MediaInputValue } from "@/lib/client/api";
import type { Draft } from "@/lib/client/store";
import { humanize } from "@/lib/client/format";

export interface ResolvedDraft {
  aspect_ratio: string | null;
  duration: number | null;
  count: number;
  maxCount: number;
  params: Record<string, unknown>;
  medias: MediaInputValue[];
}

export function resolveDuration(value: number | null, model: PublicModel | null): number | null {
  if (!model) return null;
  if (model.durations && model.durations.length > 0) {
    if (value !== null && model.durations.includes(value)) return value;
    return model.default_duration ?? model.durations[0];
  }
  if (model.duration_range) {
    const { min, max } = model.duration_range;
    const base = value ?? model.default_duration ?? min;
    return Math.min(max, Math.max(min, Math.round(base)));
  }
  return null;
}

/** Reconcile the persisted draft with the selected model's constraints. */
export function resolveDraft(draft: Draft, model: PublicModel | null): ResolvedDraft {
  if (!model) return { aspect_ratio: null, duration: null, count: 1, maxCount: 4, params: {}, medias: [] };
  const aspect_ratio = model.aspect_ratios.length > 0 ? (draft.aspect_ratio && model.aspect_ratios.includes(draft.aspect_ratio) ? draft.aspect_ratio : model.aspect_ratios[0]) : null;
  const maxCount = Math.max(1, Math.min(4, model.max_count ?? 4));
  const count = Math.min(Math.max(1, Math.round(draft.count || 1)), maxCount);
  const params: Record<string, unknown> = {};
  for (const p of model.parameters) {
    const value = draft.params[p.name] ?? p.default;
    if (value !== undefined && value !== null && value !== "") params[p.name] = value;
  }
  const medias: MediaInputValue[] = model.medias.flatMap((slot) =>
    (draft.medias[slot.role as MediaRole] ?? []).slice(0, slot.max ?? 1).map((value) => ({ role: slot.role, value })),
  );
  return { aspect_ratio, duration: resolveDuration(draft.duration, model), count, maxCount, params, medias };
}

export function requiresPrompt(model: PublicModel): boolean {
  return model.capabilities.some((c) => c.startsWith("text-to")) && !model.medias.some((m) => m.required);
}

/** Client-side preflight mirroring the server normaliser's fatal checks. */
export function validationIssues(model: PublicModel, draft: Draft, resolved: ResolvedDraft): string[] {
  const issues: string[] = [];
  if (requiresPrompt(model) && draft.prompt.trim() === "") issues.push("A prompt is required for this model.");
  for (const slot of model.medias) {
    if (slot.required && !resolved.medias.some((m) => m.role === slot.role)) issues.push(`${humanize(slot.role)} is required.`);
  }
  for (const p of model.parameters) {
    if (p.required && resolved.params[p.name] === undefined) issues.push(`Parameter ${humanize(p.name)} is required.`);
  }
  return issues;
}

export function buildGenerateBody(model: PublicModel, draft: Draft, resolved: ResolvedDraft): GenerateBody {
  return {
    model: model.id,
    prompt: draft.prompt.trim() || undefined,
    negative_prompt: draft.negative_prompt.trim() || undefined,
    aspect_ratio: resolved.aspect_ratio ?? undefined,
    duration: resolved.duration ?? undefined,
    count: resolved.count,
    medias: resolved.medias,
    params: resolved.params,
  };
}
