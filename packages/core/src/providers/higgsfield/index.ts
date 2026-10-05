import type { ProviderBinding } from "../../catalog/types";
import { extractOutputs, prepareProviderRequest } from "../../catalog/mapping";
import type { ProviderJobRef } from "../../jobs/types";
import { ambiguousSubmit, isAmbiguousSubmitStatus, StudioError, withSubmissionOutcome } from "../../util/errors";
import { requestJson } from "../../util/http";
import type { FetchLike, JobStatusResult, ProviderAdapter, SubmitInput, SubmitResult, WebhookEvent, WebhookRequest } from "../types";

export interface HiggsfieldProviderOptions {
  /** Credential as key-id:key-secret; stored encrypted by the web app. */
  credential?: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

interface RequestRecord {
  request_id?: string;
  status?: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: Array<{ url: string }>;
  video?: { url: string };
  payload?: Record<string, unknown> | null;
}

/** Direct Higgsfield API adapter. This uses API dollars, not Higgsfield plan credits. */
export class HiggsfieldProvider implements ProviderAdapter {
  readonly id = "higgsfield" as const;
  private readonly credential: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: HiggsfieldProviderOptions = {}) {
    this.credential = options.credential;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? "https://api.higgsfield.ai").replace(/\/+$/, "");
  }

  isConfigured(): boolean {
    const split = this.credential?.indexOf(":") ?? -1;
    return split > 0 && split < (this.credential?.length ?? 0) - 1;
  }

  private headers(): Record<string, string> {
    if (!this.isConfigured()) throw new StudioError("provider_unavailable", "Higgsfield API key ID and secret are not configured");
    return { authorization: `Key ${this.credential}` };
  }

  private endpointUrl(endpoint: string, estimate = false): URL {
    if (!/^[a-z0-9][a-z0-9/._-]*$/i.test(endpoint) || endpoint.includes("..")) throw new StudioError("invalid_request", "invalid Higgsfield model endpoint");
    return new URL(`${this.baseUrl}/${estimate ? "estimate/" : ""}${endpoint}`);
  }

  /** True for https URLs on the API origins the credential may be sent to. */
  private isTrusted(value: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    // Generation POSTs use api.higgsfield.ai; live status/cancel URLs are
    // returned on platform.higgsfield.ai. Accept only these exact API origins.
    const allowedOrigins = new Set([new URL(this.baseUrl).origin, "https://platform.higgsfield.ai"]);
    return url.protocol === "https:" && allowedOrigins.has(url.origin);
  }

  private trustedUrl(value: string | undefined, fallback: string): string {
    const url = value ?? fallback;
    if (!this.isTrusted(url)) throw new StudioError("provider_error", "Higgsfield returned a URL on an unexpected host");
    return new URL(url).toString();
  }

  /**
   * After Higgsfield accepted a job the ref must be stored whatever URLs came
   * back: an untrusted or malformed status/cancel URL is replaced by the
   * composed one on the API host, so the credential never leaves it.
   */
  private safeUrl(value: string | undefined, fallback: string): string {
    return value !== undefined && this.isTrusted(value) ? new URL(value).toString() : fallback;
  }

  async quote(input: SubmitInput): Promise<number | undefined> {
    const { endpoint, body } = prepareProviderRequest(input);
    const response = await requestJson<{ usd?: string | number | null; type?: string; pricing_description?: string }>(this.fetchImpl, this.endpointUrl(endpoint, true).toString(), { method: "POST", headers: this.headers(), body });
    if (!response.ok) throw this.error(response.status, response.text);
    if (response.json?.type === "description" && response.json.pricing_description) return undefined;
    if (response.json?.usd === undefined || response.json.usd === null) throw new StudioError("provider_error", "Higgsfield estimate did not return a USD amount or pricing description");
    const usd = Number(response.json?.usd);
    if (!Number.isFinite(usd) || usd < 0) throw new StudioError("provider_error", "Higgsfield estimate did not return a valid USD amount");
    return usd;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    let prepared: ReturnType<typeof prepareProviderRequest>;
    let url: URL;
    let headers: Record<string, string>;
    try {
      prepared = prepareProviderRequest(input);
      url = this.endpointUrl(prepared.endpoint);
      if (input.webhookUrl) url.searchParams.set("hf_webhook", input.webhookUrl);
      headers = this.headers();
    } catch (error) {
      throw withSubmissionOutcome(error, "rejected");
    }
    const { endpoint, body } = prepared;
    const response = await requestJson<RequestRecord>(this.fetchImpl, url.toString(), { method: "POST", headers, body, ambiguousOnTransportError: true });
    const data = response.json;
    const requestId = typeof data?.request_id === "string" && data.request_id !== "" ? data.request_id : undefined;
    if (!response.ok || !requestId) {
      if (response.ok) throw ambiguousSubmit("provider_error", `Higgsfield API HTTP ${response.status} without a request_id; the job may still run`, { status: response.status, details: response.text.slice(0, 400) });
      if (isAmbiguousSubmitStatus(response.status)) throw ambiguousSubmit("provider_unavailable", `Higgsfield API HTTP ${response.status}: the job may have been accepted`, { status: response.status, details: response.text.slice(0, 400) });
      throw withSubmissionOutcome(this.error(response.status, response.text), "rejected");
    }
    const base = `${this.baseUrl}/requests/${encodeURIComponent(requestId)}`;
    return {
      ref: {
        provider: "higgsfield",
        providerJobId: requestId,
        endpoint,
        statusUrl: this.safeUrl(data?.status_url, `${base}/status`),
        cancelUrl: this.safeUrl(data?.cancel_url, `${base}/cancel`),
      },
      providerInput: body,
      adjustments: prepared.adjustments,
      raw: data,
    };
  }

  async getStatus(ref: ProviderJobRef, binding: ProviderBinding): Promise<JobStatusResult> {
    const url = this.trustedUrl(ref.statusUrl, `${this.baseUrl}/requests/${encodeURIComponent(ref.providerJobId)}/status`);
    const response = await requestJson<RequestRecord>(this.fetchImpl, url, { headers: this.headers() });
    if (!response.ok || !response.json) throw this.error(response.status, response.text);
    return this.toStatus(response.json, binding);
  }

  async cancel(ref: ProviderJobRef): Promise<boolean> {
    const url = this.trustedUrl(ref.cancelUrl, `${this.baseUrl}/requests/${encodeURIComponent(ref.providerJobId)}/cancel`);
    const response = await requestJson(this.fetchImpl, url, { method: "POST", headers: this.headers() });
    return response.status === 202;
  }

  async parseWebhook(request: WebhookRequest): Promise<WebhookEvent> {
    let data: RequestRecord;
    try {
      data = JSON.parse(request.rawBody) as RequestRecord;
    } catch {
      data = {};
    }
    const status = data.status === "completed" ? "succeeded" : data.status === "canceled" ? "cancelled" : data.status === "nsfw" || data.status === "failed" ? "failed" : "running";
    return {
      provider: "higgsfield",
      providerJobId: data.request_id ?? "",
      state: status,
      payload: data.payload ?? data,
      error: status === "failed" ? { code: data.status ?? "failed", message: data.error ?? "Higgsfield generation failed" } : undefined,
      // Higgsfield does not sign webhooks; hosts verify their own callback token in the URL.
      verified: false,
      payloadAuthenticated: false,
      raw: data,
    };
  }

  private toStatus(data: RequestRecord, binding: ProviderBinding): JobStatusResult {
    if (data.status === "queued") return { state: "queued", raw: data };
    if (data.status === "in_progress") return { state: "running", raw: data };
    if (data.status === "canceled") return { state: "cancelled", raw: data };
    if (data.status === "failed" || data.status === "nsfw") return { state: "failed", error: { code: data.status, message: data.error ?? `Higgsfield ${data.status}` }, raw: data };
    if (data.status === "completed") {
      const outputs = extractOutputs(binding.output, data.payload ?? data);
      if (outputs.length === 0) return { state: "failed", error: { code: "no_outputs", message: "Higgsfield completed without mapped media outputs" }, raw: data };
      return { state: "succeeded", outputs, raw: data };
    }
    return { state: "running", raw: data };
  }

  private error(status: number, detail: string): StudioError {
    const code = status === 400 || status === 422 ? "invalid_request"
      : status === 401 ? "unauthorized"
      : status === 403 ? "insufficient_credits"
      : status === 404 || status === 423 || status === 503 ? "provider_unavailable"
      : status === 429 ? "provider_rate_limited" : "provider_error";
    return new StudioError(code, `Higgsfield API HTTP ${status}: ${detail.slice(0, 400)}`, { status, retryable: status >= 500 || status === 429 });
  }
}
