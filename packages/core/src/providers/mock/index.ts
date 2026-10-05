import type { OutputType, ProviderBinding } from "../../catalog/types";
import { prepareProviderRequest } from "../../catalog/mapping";
import type { JobState, NormalizedRequest, ProviderJobRef, ProviderOutput } from "../../jobs/types";
import { dimensionsFor } from "../../util/aspect";
import { base64UrlToBytes, bytesToBase64Url, utf8 } from "../../util/crypto";
import type { JobStatusResult, ProviderAdapter, SubmitInput, SubmitResult, UploadInput, UploadResult, WebhookEvent, WebhookRequest } from "../types";
import { mockArtworkDataUrl, seedFromText } from "./artwork";

export { mockArtworkDataUrl, mockArtworkSvg, seedFromText, type MockArtworkOptions } from "./artwork";
export { MOCK_PROVIDER_NOTE, mockBindingFor, withMockBindings } from "./bindings";

/** Hosted CC0/placeholder assets used by the step mode (`runningPolls`) and as `placeholders` defaults there. */
export const MOCK_PLACEHOLDERS = {
  image: "https://placehold.co/1024x1024.png",
  video: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  audio: "https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3",
  model: "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
} as const;

/** Default simulated time from submit to success: 3-8 s, picked per job from its seed. */
export const MOCK_DEFAULT_DELAY_MS = { min: 3_000, max: 8_000 } as const;

/** What an output resolver gets to pick a sample file for one output of a simulated job. */
export interface MockOutputRequest {
  /** Catalog model id. */
  model: string;
  outputType: OutputType;
  prompt?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  /** Outputs in this job (`index` runs from 0 to count - 1). */
  count: number;
  /** Stable per model and prompt: use it to choose or colour sample media deterministically. */
  seed: number;
}

/** One simulated output. `contentType` decides the output kind (image/*, video/*, audio/*, model/*). */
export interface MockOutput {
  url: string;
  contentType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

/** Return a sample output, or undefined to use the built-in placeholder. */
export type MockOutputResolver = (request: MockOutputRequest, index: number) => MockOutput | undefined;

export interface MockProviderOptions {
  /**
   * Simulated time from submit to success (simulated mode): a fixed number of
   * milliseconds or a range from which each job picks a value from its seed.
   * Default 3-8 s.
   */
  delayMs?: number | { min: number; max: number };
  /** Supplies sample files (e.g. local demo videos). Without one, images are generated SVGs. */
  resolveOutput?: MockOutputResolver;
  /**
   * Step mode for host test suites: keep jobs in memory and report "running"
   * for this many polls, then succeed with the hosted `MOCK_PLACEHOLDERS`.
   * Only works inside one process; leave it unset for the offline demo.
   */
  runningPolls?: number;
  /** Return a failure for prompts containing this marker (default "[fail]"). */
  failMarker?: string;
  /** Placeholder URLs per output type (step mode default: `MOCK_PLACEHOLDERS`; simulated mode: generated SVGs). */
  placeholders?: Partial<Record<"image" | "video" | "audio" | "model", string>>;
  /** Clock (ms since epoch); inject it to make simulated timing deterministic in tests. */
  now?: () => number;
  /**
   * Report parsed webhooks as verified. Default: true in step mode (a test
   * double), false in simulated mode, where anyone could post to the webhook
   * route. The simulated mode never sends webhooks itself.
   */
  trustWebhooks?: boolean;
}

interface MockJob {
  binding: ProviderBinding;
  input: SubmitInput;
  polls: number;
  createdAt: number;
}

/** Everything a simulated job needs, encoded into its provider job id so any instance can answer a poll. */
interface SimulatedJob {
  v: 1;
  /** Created at (ms). */
  t: number;
  /** Delay until success (ms). */
  d: number;
  m: string;
  o: OutputType;
  n: number;
  a?: string;
  s?: number;
  p?: string;
  x: number;
  f?: 1;
}

const ID_PREFIX = "mock_";
const PROMPT_IN_ID = 200;
const JOB_STATES: ReadonlySet<string> = new Set<JobState>(["pending", "queued", "running", "succeeded", "failed", "cancelled"]);

/**
 * Offline provider: serves every catalog model (through `withMockBindings`)
 * with placeholder media and zero cost, so the whole UI, API and MCP flow can
 * run without provider keys.
 *
 * Simulated mode (default): stateless. The job id carries the request summary
 * and the submit time, and the state follows the elapsed time: queued, then
 * running, then succeeded after `delayMs` (or failed when the prompt contains
 * the fail marker). Any instance can answer a poll, so it works on serverless
 * hosts and survives router rebuilds. Images are deterministic SVG data URLs
 * at the requested aspect ratio; video, audio and 3D outputs come from
 * `resolveOutput` or `placeholders`, otherwise they fall back to an
 * image-typed SVG placeholder (with a play button for video).
 *
 * Step mode (`runningPolls` set): the in-memory test double used by host test
 * suites, with poll-count timing and hosted placeholder URLs.
 */
export class MockProvider implements ProviderAdapter {
  readonly id = "mock" as const;
  /** Submitted jobs (step mode only; the simulated mode keeps no state). */
  readonly jobs = new Map<string, MockJob>();
  private counter = 0;
  private readonly options: MockProviderOptions & { failMarker: string };
  private readonly stepMode: boolean;

  constructor(options: MockProviderOptions = {}) {
    this.options = { ...options, failMarker: options.failMarker ?? "[fail]" };
    this.stepMode = options.runningPolls !== undefined;
  }

  isConfigured(): boolean {
    return true;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const prepared = prepareProviderRequest(input);
    let id: string;
    if (this.stepMode) {
      id = `${ID_PREFIX}${++this.counter}_${Math.random().toString(36).slice(2, 8)}`;
      this.jobs.set(id, { binding: input.binding, input, polls: 0, createdAt: this.now() });
    } else {
      id = encodeJob(this.simulatedJob(input.model.id, input.model.output_type, prepared.request));
    }
    return {
      ref: { provider: "mock", providerJobId: id, endpoint: input.binding.endpoint },
      providerInput: prepared.body,
      adjustments: prepared.adjustments,
    };
  }

  async getStatus(ref: ProviderJobRef): Promise<JobStatusResult> {
    return this.stepMode ? this.stepStatus(ref) : this.simulatedStatus(ref);
  }

  async cancel(ref: ProviderJobRef): Promise<boolean> {
    // Simulated jobs have no state to drop; the host stops polling a cancelled job.
    return this.stepMode ? this.jobs.delete(ref.providerJobId) : decodeJob(ref.providerJobId) !== undefined;
  }

  /** Accepts `{ providerJobId, state, payload }` for manual testing. Never throws. */
  async parseWebhook(request: WebhookRequest): Promise<WebhookEvent> {
    const verified = this.options.trustWebhooks ?? this.stepMode;
    let body: unknown;
    try {
      body = JSON.parse(request.rawBody || "{}");
    } catch {
      body = undefined;
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return { provider: "mock", providerJobId: "", state: "failed", error: { code: "bad_payload", message: "unparseable mock webhook" }, verified: false, payloadAuthenticated: false, raw: request.rawBody };
    }
    const record = body as { providerJobId?: unknown; state?: unknown; payload?: unknown };
    const state = typeof record.state === "string" && JOB_STATES.has(record.state) ? (record.state as JobState) : "succeeded";
    return {
      provider: "mock",
      providerJobId: typeof record.providerJobId === "string" ? record.providerJobId : "",
      state,
      payload: record.payload,
      verified,
      payloadAuthenticated: verified,
      raw: body,
    };
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    return { url: input.sourceUrl ?? `https://placehold.co/512x512.png?upload=${encodeURIComponent(input.filename)}` };
  }

  // ---------------------------------------------------------------- simulated

  private simulatedJob(model: string, outputType: OutputType, request: NormalizedRequest): SimulatedJob {
    const seed = seedFromText(`${model}\n${request.prompt ?? ""}`);
    const job: SimulatedJob = { v: 1, t: this.now(), d: pickDelay(this.options.delayMs, seed), m: model, o: outputType, n: Math.max(1, request.count), x: seed };
    if (request.aspect_ratio) job.a = request.aspect_ratio;
    if (request.duration !== undefined) job.s = request.duration;
    if (request.prompt) job.p = request.prompt.slice(0, PROMPT_IN_ID);
    if (request.prompt?.includes(this.options.failMarker)) job.f = 1;
    return job;
  }

  private simulatedStatus(ref: ProviderJobRef): JobStatusResult {
    const job = decodeJob(ref.providerJobId);
    if (!job) return { state: "failed", error: { code: "not_found", message: "unknown mock job" } };
    const elapsed = this.now() - job.t;
    const queuedFor = Math.min(1_000, Math.round(job.d * 0.2));
    if (elapsed < queuedFor) return { state: "queued", queuePosition: 1 };
    if (elapsed < job.d) return { state: "running", progress: Math.min(99, Math.max(1, Math.round((elapsed / job.d) * 100))) };
    if (job.f) return { state: "failed", error: { code: "mock_failure", message: "prompt contained the fail marker", retryable: false } };
    return { state: "succeeded", outputs: this.simulatedOutputs(job), costUsd: 0 };
  }

  private simulatedOutputs(job: SimulatedJob): ProviderOutput[] {
    const request: MockOutputRequest = { model: job.m, outputType: job.o, count: job.n, seed: job.x };
    if (job.p !== undefined) request.prompt = job.p;
    if (job.a !== undefined) request.aspectRatio = job.a;
    if (job.s !== undefined) request.durationSeconds = job.s;
    const outputs: ProviderOutput[] = [];
    for (let i = 0; i < job.n; i++) {
      const resolved = this.options.resolveOutput?.(request, i);
      outputs.push(resolved ? toProviderOutput(resolved, job.x + i) : this.placeholderOutput(request, i));
    }
    return outputs;
  }

  private placeholderOutput(request: MockOutputRequest, index: number): ProviderOutput {
    const kind = request.outputType === "3d" ? "model" : request.outputType;
    const configured = this.options.placeholders?.[kind];
    const seed = (request.seed + index * 7919) >>> 0;
    if (configured) {
      const output: ProviderOutput = { kind, url: configured, seed };
      if (kind === "video" || kind === "audio") output.duration_seconds = request.durationSeconds ?? 5;
      return output;
    }
    const { width, height } = dimensionsFor(request.aspectRatio ?? "1:1", "1k");
    // No sample file for this kind: an image-typed placeholder keeps the flow working.
    const output: ProviderOutput = { kind: "image", url: mockArtworkDataUrl({ seed, width, height, video: kind === "video" }), content_type: "image/svg+xml", width, height, seed };
    if (kind === "video" || kind === "audio") output.duration_seconds = request.durationSeconds ?? 5;
    return output;
  }

  // ---------------------------------------------------------------- step mode

  private stepStatus(ref: ProviderJobRef): JobStatusResult {
    const job = this.jobs.get(ref.providerJobId);
    if (!job) return { state: "failed", error: { code: "not_found", message: "unknown mock job" } };
    job.polls += 1;
    if (job.polls <= (this.options.runningPolls ?? 1)) return { state: "running", progress: Math.min(99, job.polls * 50) };
    if (job.input.request.prompt?.includes(this.options.failMarker)) {
      return { state: "failed", error: { code: "mock_failure", message: "prompt contained the fail marker" } };
    }
    return { state: "succeeded", outputs: this.stepOutputs(job) };
  }

  private stepOutputs(job: MockJob): ProviderOutput[] {
    const type = job.input.model.output_type;
    const count = job.input.request.count;
    const seedUrl = this.options.placeholders?.[type === "3d" ? "model" : type];
    const outputs: ProviderOutput[] = [];
    for (let i = 0; i < count; i++) {
      if (type === "image") outputs.push({ kind: "image", url: seedUrl ?? `${MOCK_PLACEHOLDERS.image}?model=${job.input.model.id}&i=${i}`, content_type: "image/png", width: 1024, height: 1024 });
      else if (type === "video") outputs.push({ kind: "video", url: seedUrl ?? `${MOCK_PLACEHOLDERS.video}?model=${job.input.model.id}&i=${i}`, content_type: "video/mp4", duration_seconds: job.input.request.duration ?? 5 });
      else if (type === "audio") outputs.push({ kind: "audio", url: seedUrl ?? `${MOCK_PLACEHOLDERS.audio}?model=${job.input.model.id}&i=${i}`, content_type: "audio/mpeg" });
      else outputs.push({ kind: "model", url: seedUrl ?? `${MOCK_PLACEHOLDERS.model}?model=${job.input.model.id}&i=${i}`, content_type: "model/gltf-binary" });
    }
    return outputs;
  }
}

/** The offline demo provider (simulated mode). Same as `new MockProvider(options)`. */
export function createMockProvider(options: Omit<MockProviderOptions, "runningPolls"> = {}): MockProvider {
  return new MockProvider(options);
}

function pickDelay(delay: MockProviderOptions["delayMs"], seed: number): number {
  if (typeof delay === "number") return Math.max(0, Math.round(delay));
  const { min, max } = delay ?? MOCK_DEFAULT_DELAY_MS;
  const low = Math.max(0, Math.round(Math.min(min, max)));
  const high = Math.max(low, Math.round(Math.max(min, max)));
  return low + (seed % (high - low + 1));
}

function encodeJob(job: SimulatedJob): string {
  return `${ID_PREFIX}${bytesToBase64Url(utf8(JSON.stringify(job)))}`;
}

/** Decode a simulated job id; undefined for step-mode ids, foreign ids and anything malformed. */
function decodeJob(id: string): SimulatedJob | undefined {
  if (!id.startsWith(ID_PREFIX)) return undefined;
  try {
    const job = JSON.parse(new TextDecoder().decode(base64UrlToBytes(id.slice(ID_PREFIX.length)))) as Partial<SimulatedJob> | null;
    if (!job || job.v !== 1 || typeof job.t !== "number" || typeof job.d !== "number" || typeof job.m !== "string" || typeof job.n !== "number" || typeof job.x !== "number") return undefined;
    if (job.o !== "image" && job.o !== "video" && job.o !== "audio" && job.o !== "3d") return undefined;
    return { ...job, n: Math.min(16, Math.max(1, Math.floor(job.n))) } as SimulatedJob;
  } catch {
    return undefined;
  }
}

function toProviderOutput(output: MockOutput, seed: number): ProviderOutput {
  const type = output.contentType.split("/")[0]?.toLowerCase();
  const kind = type === "video" || type === "audio" || type === "image" ? type : type === "model" ? "model" : "file";
  const result: ProviderOutput = { kind, url: output.url, content_type: output.contentType, seed: seed >>> 0 };
  if (output.width !== undefined) result.width = output.width;
  if (output.height !== undefined) result.height = output.height;
  if (output.durationSeconds !== undefined) result.duration_seconds = output.durationSeconds;
  return result;
}
