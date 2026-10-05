import type { KieFamily, ProviderBinding } from "../../catalog/types";
import { extractOutputs, prepareProviderRequest } from "../../catalog/mapping";
import type { JobState, ProviderJobRef, ProviderOutput } from "../../jobs/types";
import { base64ToBytes, bytesToBase64, hmacSha256, timingSafeEqual } from "../../util/crypto";
import { ambiguousSubmit, isAmbiguousSubmitStatus, StudioError, withSubmissionOutcome } from "../../util/errors";
import { header, requestJson, type JsonResponse } from "../../util/http";
import { defaultSleep, SlidingWindowLimiter } from "../../util/rate-limit";
import type { FetchLike, JobStatusResult, ProviderAdapter, SubmitInput, SubmitResult, UploadInput, UploadResult, WebhookEvent, WebhookRequest } from "../types";

/** Kie.ai credits are sold at a flat US$0.005 per credit (kie.ai/pricing, Sept 2026). */
export const KIE_USD_PER_CREDIT = 0.005;

/** Kie's documented limit: 20 task creations per 10 seconds per account. */
export const KIE_RATE_LIMIT = { limit: 20, windowMs: 10_000 } as const;

/** One limiter per API key, shared by every adapter instance in this process (routers are rebuilt often). */
const sharedLimiters = new Map<string, SlidingWindowLimiter>();

export interface KieProviderOptions {
  apiKey?: string;
  /** HMAC key configured on the Kie settings page; enables webhook signature verification. */
  webhookSecret?: string;
  fetch?: FetchLike;
  /** Default https://api.kie.ai */
  baseUrl?: string;
  /** Default https://kieai.redpandaai.co (file upload host). */
  uploadBaseUrl?: string;
  /** Folder name used for uploads. */
  uploadPath?: string;
  now?: () => number;
  webhookToleranceSeconds?: number;
  /** Sent as User-Agent (default "reflow-studio"). */
  userAgent?: string;
  /**
   * Throttle for task creations. Default: a limiter per API key shared within
   * the process at Kie's 20 per 10 s; `false` disables it (tests, or a host
   * that throttles itself).
   */
  limiter?: SlidingWindowLimiter | false;
  /** Longest a submit waits for a free rate-limit slot before failing with provider_rate_limited. Default 8 s. */
  maxThrottleWaitMs?: number;
  /** Pause before the single retry after a 429 (default 1.5 s). */
  rateLimitRetryDelayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface KieEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

interface KieJobRecord {
  taskId: string;
  model?: string;
  state?: "waiting" | "queuing" | "generating" | "success" | "fail";
  param?: string;
  resultJson?: string | Record<string, unknown>;
  failCode?: string | number;
  failMsg?: string;
  costTime?: number;
  completeTime?: number;
  createTime?: number;
  progress?: number;
  /** Credits charged for the task (present on success/fail for most market models). */
  creditsConsumed?: number | string;
  /** Spelling used by some market callback examples. */
  consumeCredits?: number | string;
}

interface KieVeoRecord {
  taskId: string;
  successFlag?: 0 | 1 | 2 | 3;
  errorCode?: string | number;
  errorMessage?: string;
  creditsConsumed?: number | string;
  consumeCredits?: number | string;
  response?: { resultUrls?: string[]; originUrls?: string[]; resolution?: string };
  info?: { resultUrls?: string[]; originUrls?: string[]; resolution?: string };
}

/**
 * Kie.ai adapter. Kie is a reseller with several endpoint families; the two we
 * use are the unified "market" jobs API and the dedicated Veo API:
 *   jobs:  POST /api/v1/jobs/createTask { model, input, callBackUrl } -> data.taskId
 *          GET  /api/v1/jobs/recordInfo?taskId=  -> data.state, data.resultJson (JSON *string*)
 *   veo:   POST /api/v1/veo/generate { ...input, callBackUrl }         -> data.taskId
 *          GET  /api/v1/veo/record-info?taskId= -> data.successFlag, data.response.resultUrls
 * The JSON body `code` is the real status (HTTP 200 with code != 200 is an error).
 * Result URLs expire (documented 14 days, observed as little as 24 h): copy outputs immediately.
 */
export class KieProvider implements ProviderAdapter {
  readonly id = "kie" as const;
  private readonly apiKey: string | undefined;
  private readonly webhookSecret: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly uploadPath: string;
  private readonly now: () => number;
  private readonly tolerance: number;
  private readonly userAgent: string;
  private readonly limiter: SlidingWindowLimiter | undefined;
  private readonly maxThrottleWaitMs: number;
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: KieProviderOptions = {}) {
    this.apiKey = options.apiKey ?? readEnv("KIE_API_KEY");
    this.webhookSecret = options.webhookSecret ?? readEnv("KIE_WEBHOOK_SECRET");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? "https://api.kie.ai").replace(/\/+$/, "");
    this.uploadBaseUrl = (options.uploadBaseUrl ?? "https://kieai.redpandaai.co").replace(/\/+$/, "");
    this.uploadPath = options.uploadPath ?? "reflow-studio";
    this.now = options.now ?? (() => Date.now());
    this.tolerance = options.webhookToleranceSeconds ?? 300;
    this.userAgent = options.userAgent ?? "reflow-studio";
    this.sleep = options.sleep ?? defaultSleep;
    this.maxThrottleWaitMs = options.maxThrottleWaitMs ?? 8_000;
    this.retryDelayMs = options.rateLimitRetryDelayMs ?? 1_500;
    this.limiter = options.limiter === false ? undefined : (options.limiter ?? this.sharedLimiter());
  }

  private sharedLimiter(): SlidingWindowLimiter | undefined {
    if (!this.apiKey) return undefined;
    let limiter = sharedLimiters.get(this.apiKey);
    if (!limiter) {
      limiter = new SlidingWindowLimiter(KIE_RATE_LIMIT);
      sharedLimiters.set(this.apiKey, limiter);
    }
    return limiter;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) throw new StudioError("provider_unavailable", "KIE_API_KEY is not configured");
    return { authorization: `Bearer ${this.apiKey}`, "user-agent": this.userAgent };
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    let prepared: ReturnType<typeof prepareProviderRequest>;
    let headers: Record<string, string>;
    try {
      prepared = prepareProviderRequest(input);
      headers = this.authHeaders();
    } catch (error) {
      throw withSubmissionOutcome(error, "rejected");
    }
    const { endpoint, body } = prepared;
    const family: KieFamily = input.binding.family ?? "jobs";
    let url: string;
    let payload: Record<string, unknown>;
    if (family === "veo") {
      url = `${this.baseUrl}/api/v1/veo/generate`;
      payload = { ...body, ...(input.webhookUrl ? { callBackUrl: input.webhookUrl } : {}) };
    } else {
      url = `${this.baseUrl}/api/v1/jobs/createTask`;
      payload = { model: endpoint, input: body, ...(input.webhookUrl ? { callBackUrl: input.webhookUrl } : {}) };
    }

    let response = await this.createTask(url, headers, payload);
    // A 429 means Kie did not take the task, so one short retry is safe and
    // usually enough to get through a burst (20 creations per 10 s).
    if (isRateLimited(response)) {
      await this.sleep(this.retryDelayMs);
      response = await this.createTask(url, headers, payload);
    }

    const taskId = response.json?.data?.taskId;
    if (response.ok && response.json?.code === 200 && taskId) {
      return {
        ref: { provider: "kie", providerJobId: taskId, endpoint, family },
        providerInput: body,
        adjustments: prepared.adjustments,
        raw: response.json,
      };
    }
    const message = response.json?.msg ?? response.text;
    // The HTTP status decides whether the task may exist: a 500 or a gateway
    // 502/504 can arrive after Kie created it, and so can a 2xx that lacks a
    // task id. An envelope with another code on HTTP 200 is an explicit refusal.
    if (isAmbiguousSubmitStatus(response.status)) throw ambiguousSubmit("provider_unavailable", `Kie submit: upstream error ${response.status}; the task may have been created`, { details: message.slice(0, 500) });
    if (response.ok && (response.json === undefined || response.json.code === 200)) {
      throw ambiguousSubmit("provider_error", `Kie submit: HTTP ${response.status} without a taskId; the task may still run at Kie`, { details: response.json ?? message.slice(0, 500) });
    }
    throw withSubmissionOutcome(mapKieError(response.json?.code ?? response.status, message, "submit"), "rejected");
  }

  private async createTask(url: string, headers: Record<string, string>, payload: Record<string, unknown>): Promise<JsonResponse<KieEnvelope<{ taskId?: string }>>> {
    if (this.limiter && !(await this.limiter.acquire(this.maxThrottleWaitMs))) {
      throw new StudioError("provider_rate_limited", `Kie submit: more than ${KIE_RATE_LIMIT.limit} task creations per ${KIE_RATE_LIMIT.windowMs / 1000} s from this server; try again shortly`, { submissionOutcome: "rejected" });
    }
    return requestJson<KieEnvelope<{ taskId?: string }>>(this.fetchImpl, url, { method: "POST", headers, body: payload, ambiguousOnTransportError: true });
  }

  async getStatus(ref: ProviderJobRef, binding: ProviderBinding): Promise<JobStatusResult> {
    const family = ref.family ?? binding.family ?? "jobs";
    if (family === "veo") {
      const response = await requestJson<KieEnvelope<KieVeoRecord>>(this.fetchImpl, `${this.baseUrl}/api/v1/veo/record-info?taskId=${encodeURIComponent(ref.providerJobId)}`, { headers: this.authHeaders() });
      const code = response.json?.code ?? response.status;
      if (!response.ok || code !== 200 || !response.json?.data) throw mapKieError(code, response.json?.msg ?? response.text, "status");
      return this.veoRecordToStatus(response.json.data, binding);
    }
    const response = await requestJson<KieEnvelope<KieJobRecord>>(this.fetchImpl, `${this.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(ref.providerJobId)}`, { headers: this.authHeaders() });
    const code = response.json?.code ?? response.status;
    if (!response.ok || code !== 200 || !response.json?.data) throw mapKieError(code, response.json?.msg ?? response.text, "status");
    return this.jobRecordToStatus(response.json.data, binding);
  }

  private jobRecordToStatus(record: KieJobRecord, binding: ProviderBinding): JobStatusResult {
    const cost = creditsOf(record);
    switch (record.state) {
      case "waiting":
      case "queuing":
        return { state: "queued", raw: record };
      case "generating":
        return { state: "running", progress: record.progress, raw: record };
      case "success": {
        const payload = parseResultJson(record.resultJson);
        const outputs = extractOutputs(binding.output, payload);
        if (outputs.length === 0) return { state: "failed", error: { code: "no_outputs", message: "Kie reported success without result URLs" }, costNative: cost, raw: record };
        return { state: "succeeded", outputs, costNative: cost, costUsd: creditsToUsd(cost), raw: record };
      }
      case "fail":
        return { state: "failed", error: { code: String(record.failCode ?? "fail"), message: record.failMsg ?? "Kie reported failure", retryable: false }, costNative: cost, raw: record };
      default:
        return { state: "running", raw: record };
    }
  }

  private veoRecordToStatus(record: KieVeoRecord, binding: ProviderBinding): JobStatusResult {
    const cost = creditsOf(record);
    switch (record.successFlag) {
      case 1: {
        const payload = record.response ?? record.info ?? {};
        const outputs = extractOutputs(binding.output, payload);
        if (outputs.length === 0) return { state: "failed", error: { code: "no_outputs", message: "Kie Veo reported success without result URLs" }, raw: record };
        return { state: "succeeded", outputs, costNative: cost, costUsd: creditsToUsd(cost), raw: record };
      }
      case 2:
      case 3:
        return { state: "failed", error: { code: String(record.errorCode ?? record.successFlag), message: record.errorMessage ?? "Kie Veo generation failed", retryable: false }, costNative: cost, raw: record };
      case 0:
      default:
        return { state: "running", raw: record };
    }
  }

  async parseWebhook(request: WebhookRequest): Promise<WebhookEvent> {
    let body: Record<string, unknown> | undefined;
    try {
      body = JSON.parse(request.rawBody) as Record<string, unknown>;
    } catch {
      body = undefined;
    }
    const data = (body?.data ?? {}) as Record<string, unknown>;
    const taskId = String(data.taskId ?? data.task_id ?? body?.taskId ?? body?.task_id ?? "");
    const timestamp = header(request.headers, "x-webhook-timestamp") ?? "";
    const signature = header(request.headers, "x-webhook-signature") ?? "";
    const verified = taskId !== "" && (await this.verifySignature(taskId, timestamp, signature));
    // Kie signs only `taskId.timestamp`, never the body: a verified webhook
    // proves the sender, not the output URLs. Hosts re-fetch with getStatus.
    const auth = { verified, payloadAuthenticated: false } as const;
    if (!body || taskId === "") {
      return { provider: "kie", providerJobId: taskId, state: "failed", error: { code: "bad_payload", message: "unparseable Kie webhook" }, ...auth, raw: request.rawBody };
    }
    // Unified jobs family: payload mirrors recordInfo.data
    if (typeof data.state === "string") {
      const record = data as unknown as KieJobRecord;
      const credits = creditsOf(record);
      const cost = { costNative: credits, costUsd: creditsToUsd(credits) };
      if (record.state === "success") return { provider: "kie", providerJobId: taskId, state: "succeeded", payload: parseResultJson(record.resultJson), ...cost, ...auth, raw: body };
      if (record.state === "fail") return { provider: "kie", providerJobId: taskId, state: "failed", error: { code: String(record.failCode ?? "fail"), message: record.failMsg ?? "Kie reported failure" }, ...cost, ...auth, raw: body };
      return { provider: "kie", providerJobId: taskId, state: record.state === "generating" ? "running" : "queued", ...auth, raw: body };
    }
    // Veo family: { code, msg, data: { taskId, info: { resultUrls }, creditsConsumed } }
    const code = typeof body.code === "number" ? body.code : 200;
    const info = (data.info ?? data.response) as Record<string, unknown> | undefined;
    const credits = creditsOf(data);
    const cost = { costNative: credits, costUsd: creditsToUsd(credits) };
    if (code === 200 && info) return { provider: "kie", providerJobId: taskId, state: "succeeded", payload: info, ...cost, ...auth, raw: body };
    if (code !== 200) return { provider: "kie", providerJobId: taskId, state: "failed", error: { code: String(code), message: String(body.msg ?? "Kie reported failure") }, ...cost, ...auth, raw: body };
    return { provider: "kie", providerJobId: taskId, state: "running", ...auth, raw: body };
  }

  /** X-Webhook-Signature = base64(HMAC-SHA256(taskId + "." + timestamp, secret)). */
  private async verifySignature(taskId: string, timestamp: string, signature: string): Promise<boolean> {
    if (!this.webhookSecret || !timestamp || !signature) return false;
    const ts = Number(timestamp);
    const nowSeconds = Math.floor(this.now() / 1000);
    if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > this.tolerance) return false;
    const expected = await hmacSha256(this.webhookSecret, `${taskId}.${timestamp}`);
    let provided: Uint8Array;
    try {
      provided = base64ToBytes(signature.trim());
    } catch {
      return false;
    }
    return timingSafeEqual(expected, provided);
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const headers = { ...this.authHeaders() };
    if (input.sourceUrl && !input.bytes) {
      const response = await requestJson<{ success?: boolean; code?: number; msg?: string; data?: { fileUrl?: string; downloadUrl?: string; expiresAt?: string } }>(
        this.fetchImpl,
        `${this.uploadBaseUrl}/api/file-url-upload`,
        { method: "POST", headers, body: { fileUrl: input.sourceUrl, uploadPath: this.uploadPath, fileName: input.filename } },
      );
      const url = response.json?.data?.fileUrl ?? response.json?.data?.downloadUrl;
      if (!response.ok || !url) throw mapKieError(response.json?.code ?? response.status, response.json?.msg ?? response.text, "upload");
      return { url, expiresAt: response.json?.data?.expiresAt };
    }
    if (!input.bytes) throw new StudioError("invalid_request", "upload needs bytes or sourceUrl");
    const response = await requestJson<{ success?: boolean; code?: number; msg?: string; data?: { fileUrl?: string; downloadUrl?: string; expiresAt?: string } }>(
      this.fetchImpl,
      `${this.uploadBaseUrl}/api/file-base64-upload`,
      { method: "POST", headers, body: { base64Data: `data:${input.contentType};base64,${bytesToBase64(input.bytes)}`, uploadPath: this.uploadPath, fileName: input.filename }, timeoutMs: 120_000 },
    );
    const url = response.json?.data?.fileUrl ?? response.json?.data?.downloadUrl;
    if (!response.ok || !url) throw mapKieError(response.json?.code ?? response.status, response.json?.msg ?? response.text, "upload");
    return { url, expiresAt: response.json?.data?.expiresAt };
  }

  async getBalance(): Promise<{ native: number; unit: string; usd?: number } | undefined> {
    const response = await requestJson<KieEnvelope<number>>(this.fetchImpl, `${this.baseUrl}/api/v1/chat/credit`, { headers: this.authHeaders() });
    if (!response.ok || response.json?.code !== 200 || typeof response.json.data !== "number") return undefined;
    return { native: response.json.data, unit: "credits", usd: response.json.data * KIE_USD_PER_CREDIT };
  }
}

/**
 * Credits charged for a task. Kie documents `creditsConsumed`; some market
 * callback examples spell it `consumeCredits`, and either may be a numeric string.
 */
export function creditsOf(record: { creditsConsumed?: unknown; consumeCredits?: unknown }): number | undefined {
  for (const value of [record.creditsConsumed, record.consumeCredits]) {
    const credits = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (Number.isFinite(credits) && credits >= 0) return credits;
  }
  return undefined;
}

function creditsToUsd(credits: number | undefined): number | undefined {
  return credits === undefined ? undefined : Math.round(credits * KIE_USD_PER_CREDIT * 1_000_000) / 1_000_000;
}

function isRateLimited(response: JsonResponse<KieEnvelope<unknown>>): boolean {
  return response.status === 429 || (response.ok && response.json?.code === 429);
}

/** Kie's `resultJson` is a JSON string on the wire (some docs show an object). Accept both. */
export function parseResultJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function mapKieError(code: number, message: string | undefined, stage: string): StudioError {
  const msg = message?.slice(0, 500) ?? "";
  switch (code) {
    case 401:
      return new StudioError("unauthorized", `Kie ${stage}: invalid or missing KIE_API_KEY`, { details: msg });
    case 402:
      return new StudioError("insufficient_credits", `Kie ${stage}: insufficient credits`, { details: msg });
    case 404:
      return new StudioError("invalid_request", `Kie ${stage}: model or task not found (${msg || "404"})`, { details: msg });
    case 400:
    case 422:
    case 451:
      return new StudioError("invalid_request", `Kie ${stage}: ${msg || "invalid request"}`, { details: msg });
    case 429:
      return new StudioError("provider_rate_limited", `Kie ${stage}: rate limited (20 task creations per 10 s)`, { details: msg });
    case 455:
    case 500:
    case 505:
      return new StudioError("provider_unavailable", `Kie ${stage}: ${msg || `upstream error ${code}`}`, { details: msg });
    default:
      return new StudioError("provider_error", `Kie ${stage}: unexpected code ${code}${msg ? ` (${msg})` : ""}`, { details: msg });
  }
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

export type { ProviderOutput as KieProviderOutput, JobState as KieJobState };
