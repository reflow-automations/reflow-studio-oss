import type { KieFamily, MediaKind, MediaRole, OutputKind, ProviderId } from "../catalog/types";

/** Lifecycle of a generation job, provider-agnostic. */
export type JobState = "pending" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set(["succeeded", "failed", "cancelled"]);

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.has(state);
}

/** A reference-media input as accepted by the API / MCP tools. */
export interface MediaInput {
  role: MediaRole;
  /** A media asset id, a previous generation id, or (API only) an https URL. */
  value: string;
}

/** The Higgsfield-style generation request accepted by the API and MCP tools. */
export interface GenerateRequest {
  model: string;
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  duration?: number;
  count?: number;
  medias?: MediaInput[];
  /** Model-specific parameters (validated against the catalog). */
  params?: Record<string, unknown>;
}

/** Media whose storage reference has been resolved to a fetchable URL. */
export interface ResolvedMedia {
  role: MediaRole;
  kind: MediaKind;
  url: string;
  /** Original identifier (asset id / generation id / url). */
  source: string;
}

/** A change the normaliser applied to the request (mirrors Higgsfield's `adjustments`). */
export interface Adjustment {
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

export interface NormalizedRequest {
  model: string;
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  duration?: number;
  count: number;
  medias: MediaInput[];
  params: Record<string, unknown>;
  adjustments: Adjustment[];
}

export interface ProviderOutput {
  kind: OutputKind;
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  seed?: number;
}

export interface JobError {
  code?: string;
  message: string;
  retryable?: boolean;
}

/** Identifies a job at its provider (enough to poll or cancel it). */
export interface ProviderJobRef {
  provider: ProviderId;
  providerJobId: string;
  endpoint: string;
  /** Kie only: the API family the job was created in. */
  family?: KieFamily;
  statusUrl?: string;
  responseUrl?: string;
  cancelUrl?: string;
}
