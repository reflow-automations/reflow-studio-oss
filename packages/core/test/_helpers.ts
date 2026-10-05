/**
 * Shared test helpers: a recording fake `fetch`, small fixture models/bindings
 * (independent of the seed catalog in src/catalog/models) and error capture
 * utilities. Not a test file itself (no `.test.ts` suffix).
 */
import type { ModelDefinition, ProviderBinding } from "../src/catalog/types";
import type { NormalizedRequest } from "../src/jobs/types";
import type { FetchLike } from "../src/providers/types";
import { StudioError } from "../src/util/errors";

// ---------------------------------------------------------------------------
// Fake fetch
// ---------------------------------------------------------------------------

export interface RecordedCall {
  url: string;
  method: string;
  /** Lower-cased header map. */
  headers: Record<string, string>;
  /** String body (JSON requests) or undefined. */
  body: string | undefined;
  /** Parsed JSON body when the body was valid JSON. */
  json: unknown;
  /** Whatever was passed as `init.body` (bytes for uploads). */
  rawBody: BodyInit | null | undefined;
}

export type RouteHandler = (call: RecordedCall) => Response | Promise<Response> | undefined;

export interface FakeFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** Swap the handler mid-test. */
  use(handler: RouteHandler): void;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function normaliseHeaders(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(raw)) {
    for (const [key, value] of raw) out[key.toLowerCase()] = value;
  } else {
    for (const [key, value] of Object.entries(raw)) out[key.toLowerCase()] = value;
  }
  return out;
}

/** A `fetch` stand-in that records every call and answers via `handler`. Throws on unhandled routes. */
export function createFakeFetch(handler: RouteHandler = () => undefined): FakeFetch {
  let current = handler;
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const body = typeof init?.body === "string" ? init.body : undefined;
    let json: unknown;
    if (body) {
      try {
        json = JSON.parse(body);
      } catch {
        json = undefined;
      }
    }
    const call: RecordedCall = {
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      headers: normaliseHeaders(init?.headers),
      body,
      json,
      rawBody: init?.body,
    };
    calls.push(call);
    const response = await current(call);
    if (!response) throw new Error(`fake fetch: unhandled ${call.method} ${call.url}`);
    return response;
  };
  return {
    fetch,
    calls,
    use(next) {
      current = next;
    },
  };
}

/** Recorded call at index `i`, failing loudly when it does not exist. */
export function callAt(ff: FakeFetch, i: number): RecordedCall {
  const call = ff.calls[i];
  if (!call) throw new Error(`expected at least ${i + 1} fetch call(s), got ${ff.calls.length}`);
  return call;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: "fixture_image",
    name: "Fixture Image",
    vendor: "Test",
    description: "Text-to-image fixture model",
    output_type: "image",
    capabilities: ["text-to-image"],
    parameters: [],
    medias: [],
    aspect_ratios: ["1:1", "16:9", "9:16"],
    tags: ["fixture"],
    bindings: [],
    status: "active",
    ...overrides,
  };
}

export function falBinding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return {
    provider: "fal",
    endpoint: "fal-ai/fixture",
    input: {
      count: { field: "num_images", max: 4 },
      roles: { image: "image_url", image_references: "image_urls[]" },
    },
    output: { outputs: [{ path: "images[]", kind: "image" }], seed_path: "seed" },
    pricing: { unit: "image", usd: 0.04, verified: true },
    priority: 2,
    ...overrides,
  };
}

export function kieBinding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return {
    provider: "kie",
    endpoint: "fixture/image",
    family: "jobs",
    input: { roles: { image_references: "image_urls[]" } },
    output: { outputs: [{ path: "resultUrls[]", kind: "image" }] },
    pricing: { unit: "image", usd: 0.02, verified: false },
    priority: 1,
    ...overrides,
  };
}

export function mockBinding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return {
    provider: "mock",
    endpoint: "mock/fixture",
    input: {},
    output: { outputs: [] },
    priority: 3,
    ...overrides,
  };
}

export function makeRequest(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return {
    model: "fixture_image",
    prompt: "a red fox",
    count: 1,
    medias: [],
    params: {},
    adjustments: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Error capture
// ---------------------------------------------------------------------------

/** Run `fn` and return the StudioError it throws (fails when it does not throw one). */
export function thrown(fn: () => unknown): StudioError {
  try {
    fn();
  } catch (error) {
    if (error instanceof StudioError) return error;
    throw new Error(`expected a StudioError, got ${String(error)}`);
  }
  throw new Error("expected function to throw");
}

/** Await `promise` and return the StudioError it rejects with (fails when it resolves). */
export async function rejection(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StudioError) return error;
    throw new Error(`expected a StudioError, got ${String(error)}`);
  }
  throw new Error("expected promise to reject");
}
