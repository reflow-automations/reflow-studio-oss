import { StudioError } from "./errors";
import type { FetchLike } from "../providers/types";

export interface JsonRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** Abort after this many milliseconds (default 30s). */
  timeoutMs?: number;
  /** A failed POST may already have been accepted; callers must not submit it elsewhere. */
  ambiguousOnTransportError?: boolean;
}

export interface JsonResponse<T = unknown> {
  status: number;
  ok: boolean;
  json: T | undefined;
  text: string;
  headers: Headers;
}

/** Small fetch wrapper: JSON in/out, timeout, never throws on HTTP errors (callers map status codes). */
export async function requestJson<T = unknown>(fetchImpl: FetchLike, url: string, options: JsonRequestOptions = {}): Promise<JsonResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetchImpl(url, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.headers ?? {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let json: T | undefined;
    if (text) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = undefined;
      }
    }
    return { status: response.status, ok: response.ok, json, text, headers: response.headers };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new StudioError("provider_unavailable", aborted ? `request to ${url} timed out` : `request to ${url} failed: ${(error as Error).message}`, {
      cause: error,
      retryable: !options.ambiguousOnTransportError,
      submissionOutcome: options.ambiguousOnTransportError ? "unknown" : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Header lookup that ignores case. */
export function header(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === lower) return value;
  return undefined;
}
