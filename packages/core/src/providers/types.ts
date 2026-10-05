import type { ModelDefinition, ProviderBinding, ProviderId } from "../catalog/types";
import type { Adjustment, JobError, JobState, NormalizedRequest, ProviderJobRef, ProviderOutput, ResolvedMedia } from "../jobs/types";

export interface SubmitInput {
  model: ModelDefinition;
  binding: ProviderBinding;
  request: NormalizedRequest;
  medias: ResolvedMedia[];
  /** Absolute URL the provider should call when the job finishes. */
  webhookUrl?: string;
  /** Our own job id, used for idempotency / correlation where the provider supports it. */
  jobId?: string;
}

export interface SubmitResult {
  ref: ProviderJobRef;
  /** Provider request body actually sent (stored for debugging / re-runs). */
  providerInput: Record<string, unknown>;
  /**
   * Binding-level adjustments applied to the request before it was sent
   * (see `effectiveRequest`): clamped duration, one output per job, a pinned
   * tier. Hosts should append these to the model-level adjustments they show.
   */
  adjustments?: Adjustment[];
  raw?: unknown;
}

export interface JobStatusResult {
  state: JobState;
  progress?: number;
  queuePosition?: number;
  outputs?: ProviderOutput[];
  error?: JobError;
  /** Provider-reported cost in USD when available. */
  costUsd?: number;
  /** Provider-reported cost in its native unit (e.g. Kie credits). */
  costNative?: number;
  raw?: unknown;
}

export interface WebhookRequest {
  /** Lower-cased header map. */
  headers: Record<string, string>;
  /** Raw request body exactly as received (needed for signature verification). */
  rawBody: string;
  url?: string;
}

export interface WebhookEvent {
  provider: ProviderId;
  providerJobId: string;
  state: JobState;
  /** The result payload to run through `extractOutputs` (only for succeeded jobs). */
  payload?: unknown;
  error?: JobError;
  costNative?: number;
  /** Provider-reported cost converted to USD when the adapter knows the rate (e.g. Kie credits). */
  costUsd?: number;
  /** The provider proved who sent the request (signature over at least the job id and a timestamp). */
  verified: boolean;
  /**
   * The signature also covers the body (fal: ED25519 over a body hash). False
   * when only the job id is signed (Kie signs `taskId.timestamp`), in which
   * case hosts should re-fetch the result with `getStatus` instead of trusting
   * output URLs from the body.
   */
  payloadAuthenticated?: boolean;
  raw: unknown;
}

export interface UploadInput {
  filename: string;
  contentType: string;
  /** Either raw bytes or a public URL the provider can fetch. */
  bytes?: Uint8Array;
  sourceUrl?: string;
}

export interface UploadResult {
  url: string;
  /** Provider-side expiry if known. */
  expiresAt?: string;
}

/** Contract every provider adapter implements. Kept small on purpose. */
export interface ProviderAdapter {
  readonly id: ProviderId;
  /** True when credentials are configured (the router skips unavailable providers). */
  isConfigured(): boolean;
  /**
   * Start a job. Errors should carry `submissionOutcome` ("rejected" when the
   * provider certainly did not start a job, "unknown" when it may have); hosts
   * only try another provider when `isSafeToFallBack(error)` is true.
   */
  submit(input: SubmitInput): Promise<SubmitResult>;
  getStatus(ref: ProviderJobRef, binding: ProviderBinding): Promise<JobStatusResult>;
  cancel?(ref: ProviderJobRef): Promise<boolean>;
  /** Verify and normalise an incoming webhook. Must not throw on bad signatures; set `verified: false` instead. */
  parseWebhook(request: WebhookRequest): Promise<WebhookEvent>;
  /** Upload a file so the provider can read it (used for user uploads and cross-provider media). */
  upload?(input: UploadInput): Promise<UploadResult>;
  /** Remaining balance in the provider's native unit, when the provider exposes it. */
  getBalance?(): Promise<{ native: number; unit: string; usd?: number } | undefined>;
  /** Account-specific USD quote; undefined when the API returns only a pricing description. */
  quote?(input: SubmitInput): Promise<number | undefined>;
}

/** Minimal fetch signature so adapters can be tested without network access. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
