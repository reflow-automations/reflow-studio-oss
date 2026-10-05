import type { ProviderBinding } from "../../catalog/types";
import { extractOutputs, prepareProviderRequest } from "../../catalog/mapping";
import type { JobError, JobState, ProviderJobRef } from "../../jobs/types";
import { ambiguousSubmit, isAmbiguousSubmitStatus, StudioError, withSubmissionOutcome } from "../../util/errors";
import { header, requestJson } from "../../util/http";
import type { FetchLike, JobStatusResult, ProviderAdapter, SubmitInput, SubmitResult, UploadInput, UploadResult, WebhookEvent, WebhookRequest } from "../types";
import { verifyFalWebhook, type JwksCache } from "./webhook";

export interface FalProviderOptions {
  apiKey?: string;
  fetch?: FetchLike;
  /** Default https://queue.fal.run */
  queueBaseUrl?: string;
  /** Default https://rest.fal.ai (storage, tokens). https://rest.alpha.fal.ai still works. */
  restBaseUrl?: string;
  /** Default https://api.fal.ai (platform APIs: models, pricing, usage). */
  platformBaseUrl?: string;
  jwksUrls?: readonly string[];
  now?: () => number;
  /** Output retention requested from fal ("7d" default on their side). Sent as X-Fal-Object-Lifecycle-Preference. */
  outputRetentionSeconds?: number | null;
  /** Largest file `upload({ sourceUrl })` will download before re-uploading (default 200 MB). */
  maxUploadBytes?: number;
}

interface FalSubmitResponse {
  request_id: string;
  response_url?: string;
  status_url?: string;
  cancel_url?: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
  queue_position?: number;
  response_url?: string;
  logs?: Array<{ message?: string }>;
  /** Set on COMPLETED when the model app failed (fal documents `error` + `error_type` on failed requests). */
  error?: string | null;
  error_type?: string | null;
}

interface FalWebhookPayload {
  request_id: string;
  gateway_request_id?: string | null;
  status: "OK" | "ERROR";
  payload?: unknown;
  error?: string | null;
  payload_error?: string | null;
}

/**
 * fal.ai adapter built directly on the queue HTTP contract:
 *   POST  https://queue.fal.run/{endpoint}?fal_webhook=...   -> { request_id, status_url, response_url, cancel_url }
 *   GET   {status_url}                                      -> { status, queue_position }
 *   GET   {response_url}                                    -> model output
 *   PUT   {cancel_url}
 * Authentication: `Authorization: Key <FAL_KEY>`.
 */
export class FalProvider implements ProviderAdapter {
  readonly id = "fal" as const;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly queueBaseUrl: string;
  private readonly restBaseUrl: string;
  private readonly platformBaseUrl: string;
  private readonly jwksUrls: readonly string[] | undefined;
  private readonly now: () => number;
  private readonly outputRetentionSeconds: number | null | undefined;
  private readonly maxUploadBytes: number;
  private readonly jwksCache: { current?: JwksCache } = {};

  constructor(options: FalProviderOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv("FAL_KEY");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.queueBaseUrl = trimSlash(options.queueBaseUrl ?? "https://queue.fal.run");
    this.restBaseUrl = trimSlash(options.restBaseUrl ?? "https://rest.fal.ai");
    this.platformBaseUrl = trimSlash(options.platformBaseUrl ?? "https://api.fal.ai");
    this.jwksUrls = options.jwksUrls;
    this.now = options.now ?? (() => Date.now());
    this.outputRetentionSeconds = options.outputRetentionSeconds;
    this.maxUploadBytes = options.maxUploadBytes ?? 200 * 1024 * 1024;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) throw new StudioError("provider_unavailable", "FAL_KEY is not configured");
    return { authorization: `Key ${this.apiKey}` };
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    let prepared: ReturnType<typeof prepareProviderRequest>;
    let url: URL;
    const headers: Record<string, string> = {};
    try {
      prepared = prepareProviderRequest(input);
      url = new URL(`${this.queueBaseUrl}/${prepared.endpoint}`);
      if (input.webhookUrl) url.searchParams.set("fal_webhook", input.webhookUrl);
      Object.assign(headers, this.authHeaders());
    } catch (error) {
      throw withSubmissionOutcome(error, "rejected");
    }
    if (this.outputRetentionSeconds !== undefined) {
      headers["x-fal-object-lifecycle-preference"] = JSON.stringify({ expiration_duration_seconds: this.outputRetentionSeconds });
    }
    const { endpoint, body } = prepared;
    const response = await requestJson<FalSubmitResponse>(this.fetchImpl, url.toString(), { method: "POST", headers, body, ambiguousOnTransportError: true });
    const detail = response.json ?? response.text;
    if (response.ok && !response.json?.request_id) {
      throw ambiguousSubmit("provider_error", `fal submit: HTTP ${response.status} without a request_id; the job may still run at fal`, { details: detail });
    }
    if (!response.ok || !response.json) {
      // A 500 or gateway 502/504 can come back after the queue accepted the job.
      if (isAmbiguousSubmitStatus(response.status)) throw ambiguousSubmit("provider_unavailable", `fal submit: upstream error ${response.status}; the job may have been queued`, { details: detail });
      throw withSubmissionOutcome(mapFalError(response.status, detail, "submit"), "rejected");
    }
    const data = response.json;
    return {
      ref: {
        provider: "fal",
        providerJobId: data.request_id,
        endpoint,
        statusUrl: data.status_url ?? this.composeUrl(endpoint, data.request_id, "status"),
        responseUrl: data.response_url ?? this.composeUrl(endpoint, data.request_id, ""),
        cancelUrl: data.cancel_url ?? this.composeUrl(endpoint, data.request_id, "cancel"),
      },
      providerInput: body,
      adjustments: prepared.adjustments,
      raw: data,
    };
  }

  async getStatus(ref: ProviderJobRef, binding: ProviderBinding): Promise<JobStatusResult> {
    const statusUrl = ref.statusUrl ?? this.composeUrl(ref.endpoint, ref.providerJobId, "status");
    const status = await requestJson<FalStatusResponse>(this.fetchImpl, statusUrl, { headers: this.authHeaders() });
    if (!status.ok || !status.json) {
      if (status.status === 404) return { state: "failed", error: { code: "not_found", message: "fal request not found (expired or invalid id)" }, raw: status.json ?? status.text };
      throw mapFalError(status.status, status.json ?? status.text, "status");
    }
    const data = status.json;
    if (data.status === "IN_QUEUE") return { state: "queued", queuePosition: data.queue_position, raw: data };
    if (data.status === "IN_PROGRESS") return { state: "running", raw: data };
    if (typeof data.error === "string" && data.error) return { state: "failed", error: describeReportedFailure(data.error, data.error_type), raw: data };
    const responseUrl = ref.responseUrl ?? data.response_url ?? this.composeUrl(ref.endpoint, ref.providerJobId, "");
    const result = await requestJson<unknown>(this.fetchImpl, responseUrl, { headers: this.authHeaders(), timeoutMs: 60_000 });
    if (!result.ok) {
      const detail = result.json ?? result.text;
      // The job finished and fal holds the (billed) output: a rate limit or a
      // gateway hiccup on this GET must be retried by the next poll, never
      // turned into a terminal failure. Model failures are reported through
      // `error` above, or replayed by the queue with fal's error body.
      if (result.status === 429) throw new StudioError("provider_rate_limited", "fal result: rate limited; retry the poll", { details: detail, retryable: true });
      if (isTransientResultFailure(result.status, result.json, result.headers)) {
        throw new StudioError("provider_unavailable", `fal result: upstream error ${result.status}; retry the poll`, { details: detail, retryable: true });
      }
      return { state: "failed", error: describeFalFailure(result.status, detail), raw: detail };
    }
    const outputs = extractOutputs(binding.output, result.json);
    if (outputs.length === 0) {
      return { state: "failed", error: { code: "no_outputs", message: "fal returned a result without any media outputs" }, raw: result.json };
    }
    return { state: "succeeded", outputs, raw: result.json };
  }

  async cancel(ref: ProviderJobRef): Promise<boolean> {
    const cancelUrl = ref.cancelUrl ?? this.composeUrl(ref.endpoint, ref.providerJobId, "cancel");
    const response = await requestJson(this.fetchImpl, cancelUrl, { method: "PUT", headers: this.authHeaders() });
    return response.status === 202;
  }

  async parseWebhook(request: WebhookRequest): Promise<WebhookEvent> {
    const requestId = header(request.headers, "x-fal-webhook-request-id") ?? "";
    const userId = header(request.headers, "x-fal-webhook-user-id") ?? "";
    const timestamp = header(request.headers, "x-fal-webhook-timestamp") ?? "";
    const signature = header(request.headers, "x-fal-webhook-signature") ?? "";
    let body: FalWebhookPayload | undefined;
    try {
      body = JSON.parse(request.rawBody) as FalWebhookPayload;
    } catch {
      body = undefined;
    }
    // `request_id` is the queue id returned at submit; `gateway_request_id` is the last retry's id.
    const providerJobId = body?.request_id ?? requestId;
    let verified =
      requestId !== "" && signature !== ""
        ? await verifyFalWebhook({ requestId, userId, timestamp, signature }, request.rawBody, {
            fetch: this.fetchImpl,
            jwksUrls: this.jwksUrls,
            cache: this.jwksCache,
            now: this.now,
          })
        : false;
    // The signed header id must belong to the job the body talks about.
    if (verified && body?.request_id && requestId !== body.request_id && requestId !== body.gateway_request_id) verified = false;
    if (!body) {
      return { provider: "fal", providerJobId, state: "failed", error: { code: "bad_payload", message: "unparseable webhook body" }, verified, payloadAuthenticated: verified, raw: request.rawBody };
    }
    let state: JobState;
    let error: WebhookEvent["error"];
    if (body.status === "OK") {
      state = "succeeded";
      if (body.payload_error) {
        // Result too large/unserialisable for the webhook: fetch it via getStatus.
        state = "running";
      }
    } else {
      state = "failed";
      const reported = typeof body.error === "string" && body.error ? body.error : undefined;
      const text = falErrorText(body.payload, reported ?? "fal reported an error");
      error = text.contentPolicy ? { code: "content_policy", message: text.message } : { code: "provider_error", message: reported ?? text.message };
    }
    // The ED25519 signature covers sha256(body), so a verified webhook also authenticates the payload.
    return { provider: "fal", providerJobId, state, payload: body.payload, error, verified, payloadAuthenticated: verified, raw: body };
  }

  /** Upload bytes to fal's CDN so an endpoint can read them. */
  async upload(input: UploadInput): Promise<UploadResult> {
    let bytes = input.bytes;
    if (!bytes && input.sourceUrl) {
      let source: Response;
      try {
        source = await this.fetchImpl(input.sourceUrl, { signal: AbortSignal.timeout(60_000) });
      } catch (error) {
        throw new StudioError("media_unresolved", `could not fetch ${input.sourceUrl}: ${(error as Error).message}`, { cause: error });
      }
      if (!source.ok) throw new StudioError("media_unresolved", `could not fetch ${input.sourceUrl} (${source.status})`);
      const declared = Number(source.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > this.maxUploadBytes) throw new StudioError("media_unresolved", `${input.sourceUrl} is larger than ${this.maxUploadBytes} bytes`);
      bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.byteLength > this.maxUploadBytes) throw new StudioError("media_unresolved", `${input.sourceUrl} is larger than ${this.maxUploadBytes} bytes`);
    }
    if (!bytes) throw new StudioError("invalid_request", "upload needs bytes or sourceUrl");
    const initiate = await requestJson<{ upload_url: string; file_url: string }>(
      this.fetchImpl,
      `${this.restBaseUrl}/storage/upload/initiate?storage_type=fal-cdn-v3`,
      { method: "POST", headers: this.authHeaders(), body: { content_type: input.contentType, file_name: input.filename } },
    );
    if (!initiate.ok || !initiate.json?.upload_url || !initiate.json.file_url) throw mapFalError(initiate.status, initiate.json ?? initiate.text, "storage initiate");
    const put = await this.fetchImpl(initiate.json.upload_url, { method: "PUT", headers: { "content-type": input.contentType }, body: bytes as BodyInit });
    if (!put.ok) throw new StudioError("provider_error", `fal storage upload failed with ${put.status}`);
    return { url: initiate.json.file_url };
  }

  /** Fetch unit prices for endpoints from the platform pricing API (max 50 ids per call). */
  async fetchPricing(endpointIds: string[]): Promise<Array<{ endpoint_id: string; unit_price: number; unit: string; currency: string }>> {
    const results: Array<{ endpoint_id: string; unit_price: number; unit: string; currency: string }> = [];
    for (let i = 0; i < endpointIds.length; i += 50) {
      const chunk = endpointIds.slice(i, i + 50);
      const url = `${this.platformBaseUrl}/v1/models/pricing?${chunk.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&")}`;
      const response = await requestJson<{ prices?: Array<{ endpoint_id: string; unit_price: number; unit: string; currency: string }> }>(this.fetchImpl, url, { headers: this.authHeaders() });
      if (!response.ok) throw mapFalError(response.status, response.json ?? response.text, "pricing");
      results.push(...(response.json?.prices ?? []));
    }
    return results;
  }

  /** Fetch the OpenAPI document for an endpoint (used by `catalog:verify`). No key required. */
  async fetchOpenApi(endpointId: string): Promise<unknown> {
    const url = `${this.platformBaseUrl}/v1/models?endpoint_id=${encodeURIComponent(endpointId)}&expand=openapi-3.0`;
    const response = await requestJson<{ models?: Array<{ openapi?: unknown }> }>(this.fetchImpl, url, { headers: this.apiKey ? this.authHeaders() : {} });
    if (!response.ok) throw mapFalError(response.status, response.json ?? response.text, "models");
    return response.json?.models?.[0]?.openapi;
  }

  private composeUrl(endpoint: string, requestId: string, suffix: "status" | "cancel" | ""): string {
    // Status/result/cancel URLs live under the *root* app id (first two path segments).
    const root = endpoint.split("/").slice(0, 2).join("/");
    const base = `${this.queueBaseUrl}/${root}/requests/${requestId}`;
    return suffix ? `${base}/${suffix}` : base;
  }
}

export interface FalErrorText {
  /** Readable, single-line description of the failure. */
  message: string;
  /** True when fal (or the upstream model) refused the input on content-policy grounds. */
  contentPolicy: boolean;
}

/** ByteDance (Seedance/Seedream) refuses references that may show a real person; fal surfaces it as a 422 `content_policy_violation`. */
const CONTENT_POLICY_MESSAGE =
  'fal rejected the input on content-policy grounds: a reference may show a real person (face, hand or body) or private information. Use references without people, or resubmit with provider: "kie" (Kie runs the same models without this pre-filter).';

/**
 * Readable text for a fal error body. Accepts a bare string, `{ detail: string }`,
 * a pydantic-style `{ detail: [{ loc, msg, type }] }` list (flattened to
 * `loc: msg; loc: msg`) or `{ message | error }`. A `content_policy_violation`
 * item is translated into a plain-language message and flagged so callers can
 * classify it as a non-retryable input problem.
 */
export function falErrorText(body: unknown, fallback = "fal request failed"): FalErrorText {
  const items = detailItems(body);
  const contentPolicy = items.some((item) => item.type === "content_policy_violation" || /content[_ ]policy|likenesses of real people/i.test(item.msg ?? ""));
  if (contentPolicy) return { message: CONTENT_POLICY_MESSAGE, contentPolicy: true };
  return { message: extractDetail(body) ?? fallback, contentPolicy: false };
}

/** Terminal failure read from a COMPLETED result GET (4xx, or a 5xx replayed with X-Fal-Error-Type). */
function describeFalFailure(status: number, body: unknown): Required<JobError> {
  const text = falErrorText(body, status === 422 ? "fal rejected the input" : `fal request failed with ${status}`);
  if (text.contentPolicy) return { code: "content_policy", message: text.message, retryable: false };
  if (status === 422) return { code: "validation_error", message: text.message, retryable: false };
  return { code: `http_${status}`, message: text.message, retryable: false };
}

/** Terminal failure reported on the COMPLETED status itself (`error` / `error_type`). */
function describeReportedFailure(error: string, errorType: string | null | undefined): Required<JobError> {
  const text = falErrorText(errorType === "content_policy_violation" ? { detail: [{ msg: error, type: errorType }] } : error);
  if (text.contentPolicy) return { code: "content_policy", message: text.message, retryable: false };
  return { code: errorType || "provider_error", message: text.message, retryable: false };
}

/**
 * A failed GET of a COMPLETED result that a later poll can fix: rate limits,
 * timeouts and gateway errors (502/503/504, or a 500 without fal's error body).
 * A stored model failure is replayed with fal's `detail` body or an
 * `X-Fal-Error-Type` header and stays terminal.
 */
function isTransientResultFailure(status: number, json: unknown, headers: Headers | undefined): boolean {
  if (status === 408 || status === 429) return true;
  if (status < 500) return false;
  if (headers?.get("x-fal-error-type")) return false;
  if (status === 502 || status === 503 || status === 504) return true;
  return detailItems(json).length === 0;
}

function mapFalError(status: number, body: unknown, stage: string): StudioError {
  const text = falErrorText(body);
  if (text.contentPolicy) return new StudioError("invalid_request", `fal ${stage}: ${text.message}`, { details: body });
  const detail = extractDetail(body);
  if (status === 401 || status === 403) return new StudioError("unauthorized", `fal ${stage}: invalid or missing FAL_KEY`, { details: body });
  if (status === 402) return new StudioError("insufficient_credits", `fal ${stage}: insufficient balance`, { details: body });
  if (status === 422 || status === 400) return new StudioError("invalid_request", `fal ${stage}: ${detail ?? "invalid input"}`, { details: body });
  if (status === 429) return new StudioError("provider_rate_limited", `fal ${stage}: rate limited`, { details: body });
  if (status >= 500) return new StudioError("provider_unavailable", `fal ${stage}: upstream error ${status}`, { details: body });
  return new StudioError("provider_error", `fal ${stage}: unexpected status ${status}${detail ? ` (${detail})` : ""}`, { details: body });
}

interface FalDetailItem {
  loc?: unknown[];
  msg?: string;
  type?: string;
}

/** Normalise the many shapes of a fal error body into a list of detail items. */
function detailItems(body: unknown): FalDetailItem[] {
  if (typeof body === "string") return body ? [{ msg: body }] : [];
  if (!body || typeof body !== "object") return [];
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return [{ msg: detail }];
  if (Array.isArray(detail)) return detail.map((d) => (d && typeof d === "object" ? (d as FalDetailItem) : { msg: String(d) }));
  if (detail && typeof detail === "object") return [detail as FalDetailItem];
  const message = (body as { message?: unknown }).message ?? (body as { error?: unknown }).error;
  return typeof message === "string" ? [{ msg: message }] : [];
}

function extractDetail(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 500) || undefined;
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  if (Array.isArray(detail)) {
    const joined = detail.map((d) => (d && typeof d === "object" ? `${(d as FalDetailItem).loc?.join(".") ?? ""}: ${(d as FalDetailItem).msg ?? JSON.stringify(d)}` : String(d))).join("; ");
    return joined || undefined;
  }
  const first = detailItems(body)[0];
  return first?.msg ?? (first ? JSON.stringify(first) : undefined);
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export { verifyFalWebhook, buildFalSignedMessage, FAL_JWKS_URLS } from "./webhook";
