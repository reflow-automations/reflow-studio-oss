import type { Capability, CostEstimate, JobState, MediaKind, MediaRole, NormalizedRequest, OutputType, ProviderId, PublicModel } from "@reflow/core";
import type { GenerationView } from "@/lib/studio/service";
import type { MediaAssetRow } from "@/lib/db/types";

export type { GenerationView, PublicModel };

/** The output types the create screens support. */
export type CreateType = "image" | "video";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.details = body.details;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

export interface MediaInputValue {
  role: MediaRole;
  value: string;
}

export interface GenerateBody {
  model: string;
  prompt?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  duration?: number;
  count?: number;
  medias?: MediaInputValue[];
  params?: Record<string, unknown>;
  provider?: ProviderId;
  idempotency_key?: string;
}

export interface EstimateResponse {
  request: NormalizedRequest;
  estimates: CostEstimate[];
}

export interface ListGenerationsResponse {
  items: GenerationView[];
  next_cursor: string | null;
}

export interface ListGenerationsParams {
  type?: OutputType;
  state?: JobState;
  limit?: number;
  before?: string;
}

export interface ListModelsParams {
  type?: OutputType;
  capability?: Capability;
  provider?: ProviderId;
  q?: string;
  limit?: number;
}

export interface ListModelsResponse {
  items: PublicModel[];
  total: number;
}

export type MediaAsset = MediaAssetRow & { url: string | null };

export interface ListMediaResponse {
  items: MediaAsset[];
  next_cursor: string | null;
}

export interface UploadTarget {
  asset_id: string;
  upload_url: string;
  /** Supabase signed-upload token; null for R2 presigned URLs. */
  token: string | null;
  object_path: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

export interface MediaResult {
  asset_id: string;
  kind: MediaKind;
  status: string;
  url: string | null;
  content_type?: string | null;
  bytes?: number | null;
}

/** Result of a bulk delete: ids that are gone, and ids left alone with the reason. */
export interface DeleteResult {
  deleted: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export interface Balance {
  spent_usd: number;
  reserved_usd: number;
  budget_usd: number;
  providers: Array<{ provider: ProviderId; native: number; unit: string; usd?: number }>;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    headers: { accept: "application/json", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  const errorBody = payload && typeof payload === "object" && "error" in payload ? (payload as { error?: unknown }).error : undefined;
  if (!response.ok || (errorBody !== null && errorBody !== undefined && typeof errorBody === "object" && "code" in (errorBody as object))) {
    const body = (payload as { error?: ApiErrorBody } | null)?.error ?? { code: `http_${response.status}`, message: text || response.statusText || "request failed" };
    throw new ApiError(response.status, body);
  }
  return payload as T;
}

function qs(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, string | number | undefined>)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const api = {
  models: {
    list: (params: ListModelsParams = {}) => request<ListModelsResponse>(`/api/v1/models${qs(params)}`),
    get: (id: string) => request<PublicModel>(`/api/v1/models/${encodeURIComponent(id)}`),
  },
  generations: {
    list: (params: ListGenerationsParams = {}) => request<ListGenerationsResponse>(`/api/v1/generations${qs(params)}`),
    get: (id: string) => request<GenerationView>(`/api/v1/generations/${encodeURIComponent(id)}`),
    create: (body: GenerateBody) => request<GenerationView>("/api/v1/generations", { method: "POST", json: body }),
    cancel: (id: string) => request<GenerationView>(`/api/v1/generations/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Delete finished generations and the media they produced (running ones come back as skipped). */
    remove: (ids: string[]) => request<DeleteResult>("/api/v1/generations/delete", { method: "POST", json: { ids } }),
    estimate: (body: GenerateBody) => request<EstimateResponse>("/api/v1/estimate", { method: "POST", json: body }),
  },
  media: {
    list: (params: { type?: MediaKind; limit?: number; before?: string } = {}) => request<ListMediaResponse>(`/api/v1/media${qs(params)}`),
    createUploadTarget: (input: { filename: string; content_type: string }) => request<UploadTarget>("/api/v1/media", { method: "POST", json: input }),
    confirm: (assetId: string) => request<MediaResult>(`/api/v1/media/${encodeURIComponent(assetId)}/confirm`, { method: "POST" }),
    importUrl: (input: { url: string; type?: "image" | "video" | "audio" }) => request<MediaResult>("/api/v1/media/import", { method: "POST", json: input }),
    /** Delete assets and their storage objects. */
    remove: (ids: string[]) => request<DeleteResult>("/api/v1/media/delete", { method: "POST", json: { ids } }),
  },
  balance: () => request<Balance>("/api/v1/balance"),
};
