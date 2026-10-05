/**
 * Shared fixtures for the StudioService tests: a manual clock, fixture models
 * bound to `MockProvider`, an in-memory Supabase (see ./_fake-supabase.ts), a
 * recording `fetch` stub that serves PNG bytes, and small lookup helpers.
 * Not a test file itself (no `.test.ts` suffix).
 */
import { vi } from "vitest";
import {
  bytesToHex,
  hmacSha256,
  isTerminal,
  MockProvider,
  ModelRegistry,
  ProviderRouter,
  rejectedSubmit,
  StudioError,
  type GenerateRequest,
  type JobStatusResult,
  type ModelDefinition,
  type ProviderAdapter,
  type ProviderBinding,
  type ProviderId,
  type RoutingStrategy,
  type SubmitInput,
  type SubmitResult,
  type WebhookEvent,
  type WebhookRequest,
} from "@reflow/core";
import type { ApiKeyRow, GenerationRow, LedgerEntryRow, MediaAssetRow, ProviderEventRow, WorkspaceRow } from "@/lib/db/types";
import { SupabaseStorageBackend } from "@/lib/storage/supabase";
import { StudioService, type CreateGenerationInput, type GenerationView, type Principal } from "@/lib/studio/service";
import { createFakeSupabase, type FakeDatabase, type FakeStorage, type FakeSupabase } from "./_fake-supabase";

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export const T0 = Date.parse("2026-09-05T10:00:00.000Z");
export const POLL_MIN_INTERVAL_MS = 3_000;
export const JOB_TIMEOUT_MS = 45 * 60 * 1000;

/** Manual clock injected as `now` into the service and the fake database. */
export class Clock {
  private offset = 0;

  constructor(private readonly base: number = T0) {}

  readonly now = (): Date => new Date(this.base + this.offset);

  iso(): string {
    return this.now().toISOString();
  }

  /** ISO timestamp `ms` milliseconds from the current instant (does not move the clock). */
  isoAt(ms: number): string {
    return new Date(this.base + this.offset + ms).toISOString();
  }

  advance(ms: number): void {
    this.offset += ms;
  }
}

// ---------------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------------

/** A tiny (invalid but recognisable) PNG: signature + IHDR header. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00]);

export interface FetchCall {
  url: string;
  method: string;
  /** Lower-cased header map. */
  headers: Record<string, string>;
}

export interface FetchStub {
  calls: FetchCall[];
  /** Override the response for matching calls; return undefined to fall back to PNG bytes. */
  respond(handler: (call: FetchCall) => Response | undefined): void;
}

export function pngResponse(bytes: Uint8Array = PNG_BYTES): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { "content-type": "image/png", "content-length": String(bytes.byteLength) } });
}

function normaliseHeaders(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  if (raw instanceof Headers) raw.forEach((value, key) => void (out[key.toLowerCase()] = value));
  else if (Array.isArray(raw)) for (const [key, value] of raw) out[key.toLowerCase()] = value;
  else for (const [key, value] of Object.entries(raw)) out[key.toLowerCase()] = value;
  return out;
}

/** Replace global `fetch` (used by `copyToStorage` / `importMediaUrl`) with a recorder that serves PNG bytes. */
export function stubFetch(): FetchStub {
  const calls: FetchCall[] = [];
  let handler: (call: FetchCall) => Response | undefined = () => undefined;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call: FetchCall = { url: input instanceof Request ? input.url : String(input), method: (init?.method ?? "GET").toUpperCase(), headers: normaliseHeaders(init?.headers) };
    calls.push(call);
    return handler(call) ?? pngResponse();
  };
  vi.stubGlobal("fetch", fetchImpl);
  return {
    calls,
    respond(next) {
      handler = next;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture models
// ---------------------------------------------------------------------------

export function mockBinding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return {
    provider: "mock",
    endpoint: "mock/fixture",
    input: { count: { field: "num_images", max: 4 }, roles: { image_references: "image_urls[]", start_image: "image_url" } },
    output: { outputs: [{ path: "images[]", kind: "image" }], seed_path: "seed" },
    pricing: { unit: "image", usd: 0.1 },
    priority: 3,
    ...overrides,
  };
}

/** fal binding for fallback tests (served by a `StubProvider` with id "fal"). */
export function falBinding(overrides: Partial<ProviderBinding> = {}): ProviderBinding {
  return {
    provider: "fal",
    endpoint: "fal-ai/fixture",
    input: { count: { field: "num_images", max: 4 } },
    output: { outputs: [{ path: "images[]", kind: "image" }] },
    pricing: { unit: "image", usd: 0.04 },
    priority: 1,
    ...overrides,
  };
}

export function makeModel(overrides: Partial<ModelDefinition> = {}): ModelDefinition {
  return {
    id: "fixture_image",
    name: "Fixture Image",
    vendor: "Test",
    description: "Text-to-image fixture model",
    output_type: "image",
    capabilities: ["text-to-image", "image-to-image"],
    parameters: [{ name: "seed", type: "integer", required: false, description: "Random seed" }],
    medias: [{ role: "image_references", kind: "image", description: "Reference images", max: 3 }],
    aspect_ratios: ["1:1", "16:9", "9:16"],
    max_count: 4,
    tags: ["fixture"],
    bindings: [mockBinding()],
    status: "active",
    ...overrides,
  };
}

/** $0.10 per image at the mock. */
export const IMAGE_MODEL: ModelDefinition = makeModel();

/** Image-to-video, 5 s default at $0.05/s = $0.25 per generation at the mock. */
export const VIDEO_MODEL: ModelDefinition = makeModel({
  id: "fixture_video",
  name: "Fixture Video",
  description: "Image-to-video fixture model",
  output_type: "video",
  capabilities: ["image-to-video"],
  parameters: [],
  medias: [{ role: "start_image", kind: "image", description: "First frame", required: true }],
  aspect_ratios: ["16:9"],
  durations: [5, 10],
  default_duration: 5,
  max_count: 1,
  bindings: [mockBinding({ endpoint: "mock/fixture-video", input: { roles: { start_image: "image_url" }, duration: { field: "duration" } }, output: { outputs: [{ path: "video", kind: "video" }] }, pricing: { unit: "second", usd: 0.05 } })],
});

// ---------------------------------------------------------------------------
// Provider doubles
// ---------------------------------------------------------------------------

/** Minimal adapter whose `submit` always throws (configurable); used to exercise router fallback. */
export class StubProvider implements ProviderAdapter {
  readonly submitCalls: SubmitInput[] = [];

  constructor(
    readonly id: ProviderId,
    private readonly options: { submitError?: () => unknown; balance?: { native: number; unit: string; usd?: number } } = {},
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    this.submitCalls.push(input);
    // Default: the provider definitely refused the job, so the router may try the next one.
    throw this.options.submitError?.() ?? rejectedSubmit("provider_unavailable", `${this.id} is down`);
  }

  async getStatus(): Promise<JobStatusResult> {
    throw new Error(`StubProvider(${this.id}).getStatus is not stubbed`);
  }

  async parseWebhook(): Promise<WebhookEvent> {
    throw new Error(`StubProvider(${this.id}).parseWebhook is not stubbed`);
  }

  async getBalance(): Promise<{ native: number; unit: string; usd?: number } | undefined> {
    return this.options.balance;
  }
}

/**
 * A MockProvider that cannot verify webhook signatures itself (like Kie without
 * a webhook secret), so the service must fall back to the `t` URL token.
 */
export class UnsignedMockProvider extends MockProvider {
  override async parseWebhook(request: WebhookRequest): Promise<WebhookEvent> {
    return { ...(await super.parseWebhook(request)), verified: false };
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export const WEBHOOK_SECRET = "test-webhook-secret";
export const BASE_URL = "https://studio.test/";

export interface HarnessOptions {
  /** Defaults to a fresh `Clock` starting at T0. */
  clock?: Clock;
  /** Overrides the clock as the service's `now` (e.g. to follow fake timers). */
  now?: () => Date;
  monthlyBudgetUsd?: number;
  runningPolls?: number;
  /** Custom mock instance (e.g. `UnsignedMockProvider`). */
  mock?: MockProvider;
  /** Extra adapters registered before the mock. */
  providers?: ProviderAdapter[];
  strategy?: RoutingStrategy;
  models?: ModelDefinition[];
}

export interface Harness {
  service: StudioService;
  supa: FakeSupabase;
  db: FakeDatabase;
  storage: FakeStorage;
  fetch: FetchStub;
  clock: Clock;
  mock: MockProvider;
  registry: ModelRegistry;
  router: ProviderRouter;
  workspace: WorkspaceRow;
  otherWorkspace: WorkspaceRow;
  apiKey: ApiKeyRow;
  principal: Principal;
  /** `createGeneration` with defaults: fixture_image, prompt "a red fox". */
  create(request?: Partial<GenerateRequest>, input?: Partial<Omit<CreateGenerationInput, "request">>): Promise<GenerationView>;
  /** Poll (advancing the clock past the rate limit) until the generation is terminal. */
  settle(id: string, workspaceId?: string): Promise<GenerationView>;
  gen(id: string): GenerationRow;
  asset(id: string): MediaAssetRow;
  /** Ledger entries for a generation in insertion order. */
  ledger(generationId: string): LedgerEntryRow[];
  /** `[entry_type, amount_usd]` pairs for a generation in insertion order. */
  ledgerSummary(generationId: string): Array<[LedgerEntryRow["entry_type"], number]>;
  events(generationId: string | null): ProviderEventRow[];
  /** The mock provider's in-memory job for a generation. */
  mockJob(generationId: string): { polls: number; input: SubmitInput };
  /** Seed a ready image asset (with bytes in storage) owned by `workspaceId`. */
  seedReadyAsset(overrides?: Partial<MediaAssetRow>, workspaceId?: string): MediaAssetRow;
  webhookToken(generationId: string): Promise<string>;
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = options.clock ?? new Clock();
  const now = options.now ?? clock.now;
  const supa = createFakeSupabase({ now });
  const { db, storage } = supa;
  const fetch = stubFetch();
  const mock = options.mock ?? new MockProvider({ runningPolls: options.runningPolls ?? 1, now: () => now().getTime() });
  const registry = new ModelRegistry(options.models ?? [IMAGE_MODEL, VIDEO_MODEL]);
  const router = new ProviderRouter([...(options.providers ?? []), mock], { strategy: options.strategy });
  const storageBackend = new SupabaseStorageBackend(supa.client, now);
  const service = new StudioService({ db: supa.client, registry, router, storage: storageBackend, baseUrl: BASE_URL, webhookSecret: WEBHOOK_SECRET, monthlyBudgetUsd: options.monthlyBudgetUsd, now });

  const workspace = db.seed("workspaces", { id: "ws-acme", slug: "acme", name: "Acme" });
  const otherWorkspace = db.seed("workspaces", { id: "ws-other", slug: "other", name: "Other Co" });
  const apiKey = db.seed("api_keys", { id: "key-1", workspace_id: workspace.id, user_id: "user-alice", name: "ci", prefix: "rf_test", key_hash: "hash-1", scopes: ["generate"] });
  const principal: Principal = { workspaceId: workspace.id, userId: "user-alice", apiKeyId: apiKey.id };

  const gen = (id: string): GenerationRow => {
    const row = db.find("generations", id);
    if (!row) throw new Error(`no generation ${id}`);
    return row;
  };

  return {
    service,
    supa,
    db,
    storage,
    fetch,
    clock,
    mock,
    registry,
    router,
    workspace,
    otherWorkspace,
    apiKey,
    principal,
    create: (request = {}, input = {}) => service.createGeneration({ request: { model: IMAGE_MODEL.id, prompt: "a red fox", ...request }, principal, ...input }),
    async settle(id, workspaceId = workspace.id) {
      for (let i = 0; i < 6; i++) {
        const view = await service.getGeneration(id, { workspaceId, refresh: true });
        if (isTerminal(view.state)) return view;
        clock.advance(POLL_MIN_INTERVAL_MS);
      }
      throw new Error(`generation ${id} did not reach a terminal state`);
    },
    gen,
    asset(id) {
      const row = db.find("media_assets", id);
      if (!row) throw new Error(`no media asset ${id}`);
      return row;
    },
    ledger: (generationId) => db.rows("ledger_entries").filter((e) => e.generation_id === generationId),
    ledgerSummary: (generationId) => db.rows("ledger_entries").filter((e) => e.generation_id === generationId).map((e) => [e.entry_type, e.amount_usd]),
    events: (generationId) => db.rows("provider_events").filter((e) => e.generation_id === generationId),
    mockJob(generationId) {
      const jobId = gen(generationId).provider_job_id;
      const job = jobId ? mock.jobs.get(jobId) : undefined;
      if (!job) throw new Error(`no mock job for generation ${generationId}`);
      return job;
    },
    seedReadyAsset(overrides = {}, workspaceId = workspace.id) {
      const id = overrides.id ?? `asset-${db.rows("media_assets").length + 1}`;
      const objectPath = overrides.object_path ?? `${workspaceId}/image/${id}.png`;
      storage.put("media", objectPath, PNG_BYTES, "image/png");
      return db.seed("media_assets", { id, workspace_id: workspaceId, created_by: "user-alice", kind: "image", origin: "upload", status: "ready", bucket: "media", object_path: objectPath, content_type: "image/png", bytes: PNG_BYTES.byteLength, ...overrides });
    },
    webhookToken: async (generationId) => bytesToHex(await hmacSha256(WEBHOOK_SECRET, `webhook:${generationId}`)),
  };
}

/** Await `promise` and return the StudioError it rejects with (fails when it resolves or throws something else). */
export async function rejection(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StudioError) return error;
    throw new Error(`expected a StudioError, got ${String(error)}`);
  }
  throw new Error("expected promise to reject");
}
