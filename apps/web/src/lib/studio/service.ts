import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  estimateCost,
  isTerminal,
  normalizeRequest,
  StudioError,
  type CostEstimate,
  type GenerateRequest,
  type JobState,
  type JobStatusResult,
  type ModelDefinition,
  type ModelRegistry,
  type NormalizedRequest,
  type ProviderAdapter,
  type ProviderBinding,
  type ProviderId,
  type ProviderJobRef,
  type ProviderOutput,
  type ProviderRouter,
  type ResolvedMedia,
  type WebhookEvent,
  type WebhookRequest,
  hmacSha256,
  bytesToHex,
  timingSafeEqual,
  hexToBytes,
  extractOutputs,
  extractReportedCost,
  decodeDataUrl,
  isAmbiguousSubmission,
  isSafeToFallBack,
  KIE_USD_PER_CREDIT,
  PROVIDER_INFO,
  type Adjustment,
} from "@reflow/core";
import type { Database, GenerationOutputRow, GenerationRow, MediaAssetRow, MediaKind } from "@/lib/db/types";
import { objectKey, type StorageBackend } from "@/lib/storage/types";

/**
 * Resolves the provider router for a workspace (provider keys live in the
 * database per workspace). `null` asks for the environment-only router, used to
 * parse webhooks before the generation — and thus the workspace — is known.
 */
export type RouterResolver = (workspaceId: string | null) => Promise<ProviderRouter>;

export interface StudioServiceDeps {
  db: SupabaseClient<Database>;
  registry: ModelRegistry;
  /** A fixed router, or a resolver that builds one per workspace from stored provider keys. */
  router: ProviderRouter | RouterResolver;
  /** Where new bytes go (R2 in production, Supabase Storage otherwise). */
  storage: StorageBackend;
  /** Extra backends that may still hold older assets (read-only fallbacks). */
  readStorages?: StorageBackend[];
  /** Public base URL used to build webhook callback URLs. */
  baseUrl: string;
  webhookSecret: string;
  /** Hard cap on settled + reserved spend per calendar month (USD). 0/undefined = unlimited. */
  monthlyBudgetUsd?: number;
  now?: () => Date;
}

export interface Principal {
  workspaceId: string;
  userId: string;
  apiKeyId?: string;
}

export interface CreateGenerationInput {
  request: GenerateRequest;
  principal: Principal;
  /** Force a provider (otherwise the router decides). */
  provider?: ProviderId;
  idempotencyKey?: string;
  batchId?: string;
  folderId?: string;
  /** Allow raw https URLs as media values (API/MCP callers); the UI passes asset ids. */
  allowUrls?: boolean;
}

export interface GenerationView {
  id: string;
  model_id: string;
  output_type: GenerationRow["output_type"];
  provider: ProviderId | null;
  state: JobState;
  progress: number | null;
  queue_position: number | null;
  error: unknown;
  request: NormalizedRequest | GenerateRequest;
  adjustments: unknown;
  cost_estimate_usd: number | null;
  cost_actual_usd: number | null;
  created_at: string;
  finished_at: string | null;
  outputs: Array<{ index: number; kind: MediaKind; asset_id: string | null; url: string | null; provider_url: string | null; width?: number | null; height?: number | null; duration_seconds?: number | null }>;
}

/** Outcome of a bulk delete: ids that are gone, and ids left alone with the reason. */
export interface DeleteResult {
  deleted: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/** Most ids one delete call accepts (matches the REST body limit). */
export const MAX_DELETE_IDS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKIP_NOT_FOUND = "not_found";
const SKIP_RUNNING = "still running, cancel it first";

const POLL_MIN_INTERVAL_MS = 3_000;
const NON_TERMINAL: JobState[] = ["pending", "queued", "running"];
const TERMINAL_STATES: JobState[] = ["succeeded", "failed", "cancelled"];
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_COPY_BYTES = 500 * 1024 * 1024;
/** Inline data: outputs (mock placeholders) are small; anything bigger is refused. */
const MAX_INLINE_BYTES = 5 * 1024 * 1024;
const JOB_TIMEOUT_MS = 45 * 60 * 1000;
/** Consecutive failed status polls (and minimum time spent failing) before a job is given up. */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
const MIN_POLL_ERROR_SPAN_MS = 2 * 60 * 1000;
const POLL_ERROR_RETRY_MS = 30_000;

/** Version stamped on new generations (the deployed commit on Vercel). */
function appVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) || "dev";
}
type PricedCandidate = { provider: ProviderAdapter; binding: ProviderBinding; estimate: CostEstimate | undefined };

/**
 * Orchestrates the generation lifecycle on top of the provider-agnostic core:
 * normalise → route → reserve cost → submit (with fallback) → webhook/poll →
 * copy outputs into object storage (R2 / Supabase) → settle the ledger.
 */
export class StudioService {
  private readonly db: SupabaseClient<Database>;
  private readonly registry: ModelRegistry;
  private readonly routerDep: ProviderRouter | RouterResolver;
  private readonly storage: StorageBackend;
  private readonly readStorages: StorageBackend[];
  private readonly baseUrl: string;
  private readonly webhookSecret: string;
  private readonly monthlyBudgetUsd: number;
  private readonly now: () => Date;

  constructor(deps: StudioServiceDeps) {
    this.db = deps.db;
    this.registry = deps.registry;
    this.routerDep = deps.router;
    this.storage = deps.storage;
    this.readStorages = [deps.storage, ...(deps.readStorages ?? [])];
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.webhookSecret = deps.webhookSecret;
    this.monthlyBudgetUsd = deps.monthlyBudgetUsd ?? 0;
    this.now = deps.now ?? (() => new Date());
  }

  /** Router for a workspace (or the environment-only router when `null`). */
  private async routerFor(workspaceId: string | null): Promise<ProviderRouter> {
    return typeof this.routerDep === "function" ? this.routerDep(workspaceId) : this.routerDep;
  }

  // ---------------------------------------------------------------------------
  // Catalog & cost
  // ---------------------------------------------------------------------------

  get models(): ModelRegistry {
    return this.registry;
  }

  private async pricedCandidates(router: ProviderRouter, model: ModelDefinition, request: NormalizedRequest, medias: ResolvedMedia[], provider?: ProviderId): Promise<PricedCandidate[]> {
    const candidates = router.candidates(model, { provider, request });
    if (candidates.length === 0) return [];
    const priced = await Promise.all(candidates.map(async (candidate): Promise<PricedCandidate | null> => {
      const base = estimateCost(model, candidate.binding, request);
      if (!candidate.provider.quote) return { ...candidate, estimate: base };
      try {
        const usd = await candidate.provider.quote({ model, binding: candidate.binding, request, medias });
        if (usd === undefined) {
          if (!base) throw new StudioError("provider_error", `Higgsfield gave descriptive pricing for ${candidate.binding.endpoint} without a catalog fallback`);
          return { ...candidate, estimate: { ...base, verified: false, breakdown: `${base.breakdown} (published estimate; Higgsfield returned descriptive pricing, not an account USD quote)` } };
        }
        return {
          ...candidate,
          estimate: {
            usd, currency: "USD", unit: base?.unit ?? "generation", quantity: base?.quantity ?? 1,
            unitPriceUsd: base?.unitPriceUsd ?? usd, breakdown: `Account quote for ${candidate.binding.endpoint}: $${usd.toFixed(4)}`,
            verified: true, provider: candidate.binding.provider, endpoint: candidate.binding.endpoint,
          },
        };
      } catch (error) {
        if (provider || candidates.length === 1) throw error;
        // A provider without a current quote cannot win a cheapest-price comparison.
        return null;
      }
    }));
    const valid = priced.filter((candidate): candidate is PricedCandidate => candidate !== null);
    if (valid.length === 0) throw new StudioError("provider_unavailable", `no provider has a usable cost quote for ${model.id}`);
    if (router.getStrategy() === "cheapest" && !provider) valid.sort((a, b) => (a.estimate?.usd ?? Number.POSITIVE_INFINITY) - (b.estimate?.usd ?? Number.POSITIVE_INFINITY));
    return valid;
  }

  /** Cost estimates for every configured provider that can serve the request. */
  async estimate(workspaceId: string, request: GenerateRequest, provider?: ProviderId): Promise<{ request: NormalizedRequest; estimates: CostEstimate[] }> {
    const model = this.registry.require(request.model);
    const normalized = normalizeRequest(model, request);
    const router = await this.routerFor(workspaceId);
    const needsProviderQuote = router.candidates(model, { provider, request: normalized }).some((candidate) => Boolean(candidate.provider.quote));
    const medias = needsProviderQuote ? await this.resolveMedias(workspaceId, normalized, { allowUrls: true }) : [];
    const candidates = await this.pricedCandidates(router, model, normalized, medias, provider);
    const estimates = candidates.map((c) => c.estimate).filter((e): e is CostEstimate => Boolean(e));
    return { request: normalized, estimates };
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async createGeneration(input: CreateGenerationInput): Promise<GenerationView> {
    const model = this.registry.require(input.request.model);
    const normalized = normalizeRequest(model, input.request);
    const { workspaceId, userId, apiKeyId } = input.principal;

    if (input.idempotencyKey) {
      const { data: existing } = await this.db
        .from("generations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing) return this.getGeneration(existing.id, { workspaceId });
    }

    const router = await this.routerFor(workspaceId);
    const medias = await this.resolveMedias(workspaceId, normalized, { allowUrls: input.allowUrls ?? false });
    const candidates = await this.pricedCandidates(router, model, normalized, medias, input.provider);
    if (candidates.length === 0) router.route(model, { provider: input.provider, request: normalized });
    const first = candidates[0]!;
    const estimate = first.estimate;
    // A later provider may cost more. Reserve the highest known candidate cost
    // before submission so fallback cannot silently exceed the monthly budget.
    const reservationUsd = round6(Math.max(0, ...candidates.map((c) => c.estimate?.usd ?? 0)));

    const { data: row, error } = await this.db
      .from("generations")
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        api_key_id: apiKeyId ?? null,
        model_id: model.id,
        output_type: model.output_type,
        request: normalized as unknown as GenerationRow["request"],
        adjustments: normalized.adjustments as unknown as GenerationRow["adjustments"],
        state: "pending",
        idempotency_key: input.idempotencyKey ?? null,
        batch_id: input.batchId ?? null,
        folder_id: input.folderId ?? null,
        cost_estimate_usd: estimate?.usd ?? null,
        app_version: appVersion(),
      })
      .select("*")
      .single();
    if (error || !row) throw new StudioError("provider_error", `could not create generation: ${error?.message ?? "unknown"}`, { status: 500 });

    // Budget check and reservation in one database call (advisory lock per workspace), so concurrent submits cannot overshoot the cap.
    await this.reserveBudget(row, reservationUsd, first.binding.provider);

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const webhookUrl = await this.webhookUrl(candidate.provider.id, row.id);
        const result = await candidate.provider.submit({ model, binding: candidate.binding, request: normalized, medias, webhookUrl, jobId: row.id });
        // Binding-level changes (one output per job, clamped duration, pinned tier) come from the core.
        const adjustments: Adjustment[] = [...normalized.adjustments, ...(result.adjustments ?? [])];
        const { data: claimed, error: updateError } = await this.db
          .from("generations")
          .update({
            state: "queued",
            provider: candidate.provider.id,
            provider_endpoint: candidate.binding.endpoint,
            provider_job_id: result.ref.providerJobId,
            provider_ref: result.ref as unknown as GenerationRow["provider_ref"],
            provider_input: result.providerInput as unknown as GenerationRow["provider_input"],
            adjustments: adjustments as unknown as GenerationRow["adjustments"],
            cost_estimate_usd: candidate.estimate?.usd ?? null,
            started_at: this.now().toISOString(),
            next_poll_at: new Date(this.now().getTime() + 10_000).toISOString(),
          })
          .eq("id", row.id)
          .in("state", NON_TERMINAL)
          .select("id");
        await this.event(candidate.provider.id, result.ref.providerJobId, row.id, "submit", { state: "queued", payload: result.raw });
        if (updateError) throw new StudioError("provider_error", `submitted to ${candidate.provider.id} but could not record the job: ${updateError.message}`, { status: 500 });
        if (!claimed?.length) {
          // Cancelled while submitting: best-effort cancel at the provider, keep the cancelled state.
          try {
            await candidate.provider.cancel?.(result.ref);
          } catch {
            // ignore
          }
        }
        return this.getGeneration(row.id, { workspaceId });
      } catch (err) {
        lastError = err;
        await this.event(candidate.provider.id, null, row.id, "submit", { payload: { error: serializeError(err) } });
        // Fail closed: only try the next provider when this one definitely did not
        // start a job (auth, credits, rate limit, explicit rejection). Input errors
        // fail everywhere, and an ambiguous submit may already be running and billed.
        if (!isSafeToFallBack(err)) break;
      }
    }

    const message = lastError instanceof Error ? lastError.message : "submission failed";
    const ambiguous = isAmbiguousSubmission(lastError);
    const failure = ambiguous
      ? { code: "submit_ambiguous", message: `${message} (the provider may still run this job; check its dashboard before retrying)` }
      : { code: "submit_failed", message };
    const { data: failedRows } = await this.db
      .from("generations")
      .update({ state: "failed", error: failure, finished_at: this.now().toISOString() })
      .eq("id", row.id)
      .in("state", NON_TERMINAL)
      .select("id");
    if (reservationUsd > 0 && failedRows?.length) await this.ledger(workspaceId, row.id, "release", -reservationUsd, { note: ambiguous ? "submission outcome unknown" : "submission failed" });
    if (lastError instanceof StudioError) throw lastError;
    throw new StudioError("provider_error", message, { cause: lastError });
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async getGeneration(id: string, options: { workspaceId?: string; refresh?: boolean } = {}): Promise<GenerationView> {
    let query = this.db.from("generations").select("*").eq("id", id);
    if (options.workspaceId) query = query.eq("workspace_id", options.workspaceId);
    const { data: row } = await query.maybeSingle();
    if (!row) throw new StudioError("not_found", `generation ${id} not found`);
    let current = row;
    if (options.refresh && !isTerminal(row.state)) {
      try {
        current = (await this.refreshFromProvider(row)) ?? row;
      } catch {
        current = row; // the poll error is recorded in provider_events; serve the last known state
      }
    }
    return this.toView(current);
  }

  async listGenerations(workspaceId: string, options: { limit?: number; before?: string; state?: JobState; type?: GenerationRow["output_type"]; batchId?: string } = {}): Promise<{ items: GenerationView[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
    let query = this.db.from("generations").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit + 1);
    if (options.before) query = query.lt("created_at", options.before);
    if (options.state) query = query.eq("state", options.state);
    if (options.type) query = query.eq("output_type", options.type);
    if (options.batchId) query = query.eq("batch_id", options.batchId);
    const { data, error } = await query;
    if (error) throw new StudioError("provider_error", error.message, { status: 500 });
    const rows = data ?? [];
    const page = rows.slice(0, limit);
    const views = await Promise.all(page.map((row) => this.toView(row)));
    return { items: views, next_cursor: rows.length > limit ? (page[page.length - 1]?.created_at ?? null) : null };
  }

  /** Long-poll up to `timeoutMs` for the given generations to reach a terminal state (Higgsfield `jobs_wait`). */
  async waitForGenerations(ids: string[], options: { workspaceId: string; timeoutMs?: number }): Promise<{ all_terminal: boolean; items: GenerationView[] }> {
    const deadline = this.now().getTime() + Math.min(options.timeoutMs ?? 15_000, 25_000);
    let items: GenerationView[] = [];
    while (true) {
      items = await Promise.all(ids.map((id) => this.getGeneration(id, { workspaceId: options.workspaceId, refresh: true })));
      const allTerminal = items.every((g) => isTerminal(g.state));
      if (allTerminal || this.now().getTime() >= deadline) return { all_terminal: allTerminal, items };
      await sleep(Math.min(2_000, Math.max(250, deadline - this.now().getTime())));
    }
  }

  async cancelGeneration(id: string, workspaceId: string): Promise<GenerationView> {
    const { data: row } = await this.db.from("generations").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (!row) throw new StudioError("not_found", `generation ${id} not found`);
    if (isTerminal(row.state)) return this.toView(row);
    const provider = row.provider ? (await this.routerFor(row.workspace_id)).getProvider(row.provider) : undefined;
    if (provider?.cancel && row.provider_ref) {
      try {
        await provider.cancel(row.provider_ref as unknown as ProviderJobRef);
      } catch {
        // best effort
      }
    }
    await this.finalize(row, { state: "cancelled", error: { code: "cancelled", message: "cancelled by user" } });
    return this.getGeneration(id, { workspaceId });
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Delete finished generations of a workspace, plus the media they produced.
   * Running jobs are skipped (cancel first). A produced asset that another
   * generation still uses as an input (by asset id, or by this generation's id,
   * which resolves to its first output) is kept as a standalone asset. Ledger
   * rows and provider events stay: their generation_id becomes null (FK), so
   * spend history is unchanged. Storage objects are removed best-effort.
   */
  async deleteGenerations(workspaceId: string, ids: string[]): Promise<DeleteResult> {
    const { valid, skipped } = this.prepareDeleteIds(ids);
    if (valid.length === 0) return { deleted: [], skipped };

    const { data: rows, error } = await this.db.from("generations").select("id, state").eq("workspace_id", workspaceId).in("id", valid);
    if (error) throw new StudioError("provider_error", `could not read generations: ${error.message}`, { status: 500 });
    const stateById = new Map((rows ?? []).map((r) => [r.id, r.state] as const));
    const deletable: string[] = [];
    for (const id of valid) {
      const state = stateById.get(id);
      if (state === undefined) skipped.push({ id, reason: SKIP_NOT_FOUND });
      else if (!isTerminal(state)) skipped.push({ id, reason: SKIP_RUNNING });
      else deletable.push(id);
    }
    if (deletable.length === 0) return { deleted: [], skipped };

    // Media produced by these generations, and which of it must survive.
    const { data: produced, error: assetError } = await this.db
      .from("media_assets")
      .select("id, source_job_id")
      .eq("workspace_id", workspaceId)
      .eq("origin", "generated")
      .in("source_job_id", deletable);
    if (assetError) throw new StudioError("provider_error", `could not read generated media: ${assetError.message}`, { status: 500 });
    const keep = await this.referencedAssets(workspaceId, deletable, produced ?? []);

    const { data: removed, error: deleteError } = await this.db.from("generations").delete().eq("workspace_id", workspaceId).in("id", deletable).in("state", TERMINAL_STATES).select("id");
    if (deleteError) throw new StudioError("provider_error", `could not delete generations: ${deleteError.message}`, { status: 500 });
    const removedIds = new Set((removed ?? []).map((r) => r.id));
    for (const id of deletable) if (!removedIds.has(id)) skipped.push({ id, reason: SKIP_NOT_FOUND });

    const assetIds = (produced ?? []).filter((a) => a.source_job_id && removedIds.has(a.source_job_id) && !keep.has(a.id)).map((a) => a.id);
    if (assetIds.length > 0) {
      try {
        await this.deleteAssetRows(workspaceId, assetIds);
      } catch (err) {
        // The generations are gone already; leftover assets stay visible under Assets and can be deleted there.
        console.error("[studio] could not delete generated media", serializeError(err));
      }
    }
    return { deleted: deletable.filter((id) => removedIds.has(id)), skipped };
  }

  /**
   * Delete media assets of a workspace and their storage objects (best-effort).
   * generation_outputs pointing at them keep the provider URL (asset_id becomes null).
   */
  async deleteMedia(workspaceId: string, ids: string[]): Promise<DeleteResult> {
    const { valid, skipped } = this.prepareDeleteIds(ids);
    if (valid.length === 0) return { deleted: [], skipped };
    const removed = await this.deleteAssetRows(workspaceId, valid);
    for (const id of valid) if (!removed.has(id)) skipped.push({ id, reason: SKIP_NOT_FOUND });
    return { deleted: valid.filter((id) => removed.has(id)), skipped };
  }

  /** De-duplicate, enforce the batch limit and set aside ids that cannot exist (not uuids). */
  private prepareDeleteIds(ids: string[]): { valid: string[]; skipped: DeleteResult["skipped"] } {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_DELETE_IDS) throw new StudioError("invalid_request", `delete at most ${MAX_DELETE_IDS} items per call`);
    const skipped: DeleteResult["skipped"] = [];
    const valid: string[] = [];
    for (const id of unique) {
      if (UUID_RE.test(id)) valid.push(id);
      else skipped.push({ id, reason: SKIP_NOT_FOUND });
    }
    return { valid, skipped };
  }

  /**
   * Assets among `produced` that a generation outside `deleting` uses as input:
   * directly by asset id, or through a generation id (which resolves to that
   * generation's first output, see resolveMedias).
   */
  private async referencedAssets(workspaceId: string, deleting: string[], produced: Array<{ id: string; source_job_id: string | null }>): Promise<Set<string>> {
    const keep = new Set<string>();
    if (produced.length === 0) return keep;
    const deletingSet = new Set(deleting);
    const usedElsewhere = async (value: string): Promise<boolean> => {
      const { data, error } = await this.db
        .from("generations")
        .select("id")
        .eq("workspace_id", workspaceId)
        .contains("request", { medias: [{ value }] })
        .limit(deleting.length + 1);
      // Fail safe: when the check cannot run, keep the asset.
      if (error) return true;
      return (data ?? []).some((g) => !deletingSet.has(g.id));
    };

    const generationsWithMedia = [...new Set(produced.map((a) => a.source_job_id).filter((id): id is string => Boolean(id)))];
    const { data: outputs } = await this.db.from("generation_outputs").select("generation_id, index, asset_id").in("generation_id", generationsWithMedia);
    const firstOutput = new Map<string, { index: number; asset_id: string | null }>();
    for (const o of outputs ?? []) {
      const current = firstOutput.get(o.generation_id);
      if (!current || o.index < current.index) firstOutput.set(o.generation_id, { index: o.index, asset_id: o.asset_id });
    }

    const checks: Array<() => Promise<void>> = [
      ...produced.map((asset) => async () => {
        if (await usedElsewhere(asset.id)) keep.add(asset.id);
      }),
      ...generationsWithMedia.map((generationId) => async () => {
        const assetId = firstOutput.get(generationId)?.asset_id;
        if (assetId && (await usedElsewhere(generationId))) keep.add(assetId);
      }),
    ];
    for (let i = 0; i < checks.length; i += 10) await Promise.all(checks.slice(i, i + 10).map((run) => run()));
    return keep;
  }

  /** Delete asset rows (workspace-scoped), then their objects best-effort. Returns the ids that were deleted. */
  private async deleteAssetRows(workspaceId: string, ids: string[]): Promise<Set<string>> {
    const { data: removed, error } = await this.db.from("media_assets").delete().eq("workspace_id", workspaceId).in("id", ids).select("id, bucket, object_path");
    if (error) throw new StudioError("provider_error", `could not delete media: ${error.message}`, { status: 500 });
    await Promise.all(
      (removed ?? []).map(async (asset) => {
        if (!asset.object_path) return;
        const backend = this.storageFor(asset.bucket);
        if (!backend) {
          console.warn("[studio] no storage backend for bucket, object left in place", { asset: asset.id, bucket: asset.bucket });
          return;
        }
        try {
          await backend.delete(asset.bucket, asset.object_path);
        } catch (err) {
          console.warn("[studio] could not delete storage object", { asset: asset.id, bucket: asset.bucket, path: asset.object_path, error: serializeError(err).message });
        }
      }),
    );
    return new Set((removed ?? []).map((a) => a.id));
  }

  // ---------------------------------------------------------------------------
  // Webhooks & reconciliation
  // ---------------------------------------------------------------------------

  /** Handle an incoming provider webhook. `generationId`/`token` come from the callback URL query string. */
  async handleWebhook(providerId: ProviderId, request: WebhookRequest, hint: { generationId?: string; token?: string }): Promise<{ ok: boolean; generationId?: string; state?: JobState; reason?: string }> {
    let row: GenerationRow | null = null;
    if (hint.generationId) {
      const { data } = await this.db.from("generations").select("*").eq("id", hint.generationId).maybeSingle();
      row = data;
    }
    const provider = (await this.routerFor(row?.workspace_id ?? null)).getProvider(providerId);
    if (!provider) return { ok: false, reason: "unknown provider" };
    const event = await provider.parseWebhook(request);
    const tokenValid = hint.generationId && hint.token ? await this.verifyWebhookToken(hint.generationId, hint.token) : false;
    const trusted = event.verified || tokenValid;

    if (!row && event.providerJobId) {
      const { data } = await this.db.from("generations").select("*").eq("provider", providerId).eq("provider_job_id", event.providerJobId).maybeSingle();
      row = data;
    }
    await this.event(providerId, event.providerJobId || null, row?.id ?? null, "webhook", { verified: trusted, state: event.state, payload: event.raw });
    if (!row) return { ok: false, reason: "generation not found" };
    if (!trusted) return { ok: false, generationId: row.id, reason: "unverified webhook" };
    if (row.provider && row.provider !== providerId) return { ok: false, generationId: row.id, reason: "provider mismatch" };
    if (row.provider_job_id && event.providerJobId && row.provider_job_id !== event.providerJobId) return { ok: false, generationId: row.id, reason: "job id mismatch" };
    if (isTerminal(row.state)) return { ok: true, generationId: row.id, state: row.state };

    await this.db.from("generations").update({ webhook_received_at: this.now().toISOString(), webhook_verified: event.verified }).eq("id", row.id);
    const binding = this.bindingFor(row);
    const status = this.eventToStatus(event, binding);
    if (status.state === "running" || status.state === "queued") {
      // e.g. fal payload_error → fetch the result via the provider status API
      const refreshed = await this.refreshFromProvider(row, { force: true });
      return { ok: true, generationId: row.id, state: refreshed?.state ?? status.state };
    }
    await this.applyStatus(row, status);
    return { ok: true, generationId: row.id, state: status.state };
  }

  /** Poll providers for generations that have not completed; safety net when webhooks are missed. */
  async reconcile(options: { limit?: number } = {}): Promise<{ checked: number; updated: number; failed: number }> {
    const nowIso = this.now().toISOString();
    const { data } = await this.db
      .from("generations")
      .select("*")
      .in("state", ["queued", "running"])
      .or(`next_poll_at.is.null,next_poll_at.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(options.limit ?? 25);
    let updated = 0;
    let failed = 0;
    const staleBefore = new Date(this.now().getTime() - PENDING_TIMEOUT_MS).toISOString();
    const { data: stalePending } = await this.db.from("generations").select("*").eq("state", "pending").lt("created_at", staleBefore).limit(options.limit ?? 25);
    for (const row of stalePending ?? []) {
      await this.finalize(row, { state: "failed", error: { code: "submit_timeout", message: "generation never left the pending state" } });
      updated += 1;
    }
    for (const row of data ?? []) {
      try {
        const result = await this.refreshFromProvider(row, { force: true });
        if (result && result.state !== row.state) updated += 1;
      } catch {
        failed += 1;
      }
    }
    return { checked: data?.length ?? 0, updated, failed };
  }

  private async refreshFromProvider(row: GenerationRow, options: { force?: boolean } = {}): Promise<GenerationRow | null> {
    if (!row.provider || !row.provider_ref) return null;
    const lastPolled = row.last_polled_at ? new Date(row.last_polled_at).getTime() : 0;
    if (!options.force && this.now().getTime() - lastPolled < POLL_MIN_INTERVAL_MS) return row;
    if (row.started_at && this.now().getTime() - new Date(row.started_at).getTime() > JOB_TIMEOUT_MS) {
      await this.finalize(row, { state: "failed", error: { code: "timeout", message: "generation exceeded the 45 minute limit" } });
      return this.reload(row.id);
    }
    const provider = (await this.routerFor(row.workspace_id)).getProvider(row.provider);
    if (!provider) return null;
    const binding = this.bindingFor(row);
    const ref = (row.provider_ref ?? {}) as Record<string, unknown>;
    let status: JobStatusResult;
    try {
      status = await provider.getStatus(row.provider_ref as unknown as ProviderJobRef, binding);
    } catch (err) {
      // Transient failures (fal: provider_unavailable / provider_rate_limited on the result
      // fetch) are retried, but only for a bounded number of consecutive polls.
      const nowMs = this.now().getTime();
      const errors = (typeof ref.poll_errors === "number" ? ref.poll_errors : 0) + 1;
      const since = typeof ref.poll_errors_since === "string" ? ref.poll_errors_since : this.now().toISOString();
      await this.event(row.provider, row.provider_job_id, row.id, "poll", { payload: { error: serializeError(err), consecutive_errors: errors } });
      if (errors >= MAX_CONSECUTIVE_POLL_ERRORS && nowMs - Date.parse(since) >= MIN_POLL_ERROR_SPAN_MS) {
        const last = serializeError(err);
        await this.finalize(row, { state: "failed", error: { code: "poll_failed", message: `status checks failed ${errors} times in a row: ${last.message}`, last_error: last } });
        return this.reload(row.id);
      }
      await this.db
        .from("generations")
        .update({
          last_polled_at: this.now().toISOString(),
          next_poll_at: new Date(nowMs + POLL_ERROR_RETRY_MS).toISOString(),
          provider_ref: { ...ref, poll_errors: errors, poll_errors_since: since } as GenerationRow["provider_ref"],
        })
        .eq("id", row.id)
        .in("state", NON_TERMINAL);
      throw err;
    }
    if (ref.poll_errors !== undefined) {
      const clean = { ...ref };
      delete clean.poll_errors;
      delete clean.poll_errors_since;
      await this.db.from("generations").update({ provider_ref: clean as GenerationRow["provider_ref"] }).eq("id", row.id);
    }
    if (status.state !== row.state || status.error) {
      await this.event(row.provider, row.provider_job_id, row.id, "poll", { state: status.state, payload: status.raw });
    }
    await this.applyStatus(row, status);
    return this.reload(row.id);
  }

  private async applyStatus(row: GenerationRow, status: JobStatusResult): Promise<void> {
    if (isTerminal(row.state)) return;
    if (status.state === "queued" || status.state === "running") {
      const backoff = Math.min(60_000, 5_000 * Math.max(1, Math.floor((this.now().getTime() - new Date(row.started_at ?? row.created_at).getTime()) / 60_000) + 1));
      await this.db
        .from("generations")
        .update({
          state: status.state,
          progress: status.progress ?? row.progress,
          queue_position: status.queuePosition ?? null,
          last_polled_at: this.now().toISOString(),
          next_poll_at: new Date(this.now().getTime() + backoff).toISOString(),
        })
        .eq("id", row.id)
        .in("state", NON_TERMINAL);
      return;
    }
    if (status.state === "succeeded") {
      const outputs = status.outputs ?? [];
      await this.storeOutputs(row, outputs);
      await this.finalize(row, { state: "succeeded", costUsd: status.costUsd, costNative: status.costNative });
      return;
    }
    await this.finalize(row, { state: status.state, error: status.error ?? { code: "failed", message: "generation failed" }, costUsd: status.costUsd, costNative: status.costNative });
  }

  private async finalize(row: GenerationRow, result: { state: JobState; error?: unknown; costUsd?: number; costNative?: number }): Promise<void> {
    const finishedAt = this.now().toISOString();
    // Higgsfield's callback/status does not report the billed amount. Keep the
    // account quote as an estimate instead of presenting it as actual spend.
    const estimateSettles = row.provider ? PROVIDER_INFO[row.provider]?.estimateSettles !== false : true;
    const actual = result.state === "succeeded" ? (result.costUsd ?? (estimateSettles ? (row.cost_estimate_usd ?? null) : null)) : null;
    const settlement = result.state === "succeeded" ? (actual ?? row.cost_estimate_usd ?? null) : null;
    const { data: entries, error: ledgerError } = await this.db.from("ledger_entries").select("entry_type, amount_usd").eq("generation_id", row.id).in("entry_type", ["reservation", "release"]);
    if (ledgerError) throw new StudioError("provider_error", `could not read reservation: ${ledgerError.message}`, { status: 500 });
    const reserved = (entries ?? []).reduce((sum, entry) => sum + Number(entry.amount_usd), 0);
    const { data: won } = await this.db
      .from("generations")
      .update({
        state: result.state,
        error: (result.error ?? null) as GenerationRow["error"],
        finished_at: finishedAt,
        last_polled_at: finishedAt,
        next_poll_at: null,
        cost_actual_usd: actual,
        cost_native: result.costNative ?? null,
        progress: result.state === "succeeded" ? 100 : row.progress,
      })
      .eq("id", row.id)
      .in("state", NON_TERMINAL)
      .select("id");
    if (!won?.length) return; // another worker already finalized this generation
    if (reserved > 0) await this.ledger(row.workspace_id, row.id, "release", -reserved, { note: `release reservation (${result.state})` });
    if (result.state === "succeeded" && settlement !== null && settlement > 0) {
      await this.ledger(row.workspace_id, row.id, "settlement", settlement, {
        provider: row.provider ?? undefined,
        native: result.costNative,
        nativeUnit: row.provider ? PROVIDER_INFO[row.provider]?.nativeUnit?.unit : undefined,
        note: actual !== null ? (result.costUsd !== undefined ? "provider-reported cost" : "estimated cost") : "provisional account quote; provider did not report billed cost",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Media
  // ---------------------------------------------------------------------------

  /** Copy provider outputs into object storage and record generation_outputs + media_assets. */
  private async storeOutputs(row: GenerationRow, outputs: ProviderOutput[]): Promise<void> {
    for (const [index, output] of outputs.entries()) {
      const kind = output.kind === "model" || output.kind === "file" ? output.kind : output.kind;
      // Claim the output slot first so concurrent webhook/poll workers cannot both create assets for it.
      const { data: claimed } = await this.db
        .from("generation_outputs")
        .upsert(
          { generation_id: row.id, index, kind, provider_url: output.url, seed: output.seed ?? null, metadata: { width: output.width ?? null, height: output.height ?? null, duration_seconds: output.duration_seconds ?? null } as GenerationOutputRow["metadata"] },
          { onConflict: "generation_id,index", ignoreDuplicates: true },
        )
        .select("id");
      if (!claimed?.length) continue;
      const { data: asset } = await this.db
        .from("media_assets")
        .insert({
          workspace_id: row.workspace_id,
          created_by: row.created_by,
          kind,
          origin: "generated",
          status: "pending",
          source_url: output.url,
          source_job_id: row.id,
          content_type: output.content_type ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          duration_seconds: output.duration_seconds ?? null,
          // Denormalised so the library / show_medias can search past outputs by prompt.
          prompt: (row.request as { prompt?: string } | null)?.prompt ?? null,
          model_id: row.model_id,
          metadata: { seed: output.seed ?? null } as MediaAssetRow["metadata"],
        })
        .select("*")
        .single();
      if (asset) {
        await this.db.from("generation_outputs").update({ asset_id: asset.id }).eq("generation_id", row.id).eq("index", index);
        await this.copyToStorage(asset, output.url);
      }
    }
  }

  private async copyToStorage(asset: MediaAssetRow, sourceUrl: string, timeoutMs = 120_000): Promise<void> {
    try {
      if (sourceUrl.startsWith("data:")) {
        // Inline outputs (the mock provider's SVG placeholders) are decoded, never fetched.
        const decoded = decodeDataUrl(sourceUrl, { maxBytes: MAX_INLINE_BYTES });
        if (!decoded) throw new Error("invalid or oversized data URL");
        await this.writeAsset(asset, decoded.bytes, decoded.contentType, sourceUrl);
        return;
      }
      const response = await safeFetch(sourceUrl, { timeoutMs });
      if (!response.ok) throw new Error(`fetch ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_COPY_BYTES) throw new Error(`file too large (${declared} bytes)`);
      const contentType = asset.content_type && asset.content_type !== "application/octet-stream"
        ? asset.content_type
        : (response.headers.get("content-type")?.split(";")[0] ?? asset.content_type ?? "application/octet-stream");
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > MAX_COPY_BYTES) throw new Error(`file too large (${buffer.byteLength} bytes)`);
      await this.writeAsset(asset, buffer, contentType, sourceUrl);
    } catch (err) {
      // Keep the provider URL so the result stays usable until it expires.
      await this.db
        .from("media_assets")
        .update({ status: "failed", metadata: { ...(asset.metadata as Record<string, unknown>), copy_error: serializeError(err) } as MediaAssetRow["metadata"] })
        .eq("id", asset.id);
    }
  }

  private async writeAsset(asset: MediaAssetRow, bytes: Uint8Array, contentType: string, hint: string): Promise<void> {
    const ext = extensionFor(contentType, hint.startsWith("data:") ? "" : hint);
    const bucket = this.storage.buckets.media;
    const objectPath = objectKey(asset.workspace_id, asset.id, ext, this.now());
    await this.storage.put(bucket, objectPath, bytes, contentType);
    await this.db
      .from("media_assets")
      .update({ status: "ready", bucket, object_path: objectPath, content_type: contentType, bytes: bytes.byteLength })
      .eq("id", asset.id);
  }

  /** Readable (public/signed) URL for an asset, falling back to the provider URL. */
  async assetUrl(asset: Pick<MediaAssetRow, "bucket" | "object_path" | "source_url" | "status">): Promise<string | null> {
    if (asset.status === "ready" && asset.object_path) {
      const backend = this.storageFor(asset.bucket);
      if (backend) {
        const url = await backend.readUrl(asset.bucket, asset.object_path).catch(() => null);
        if (url) return url;
      }
    }
    return asset.source_url;
  }

  /** Backend that holds objects recorded under `bucket` (primary first). */
  private storageFor(bucket: string): StorageBackend | undefined {
    return this.readStorages.find((s) => s.owns(bucket));
  }

  /** Import an https URL into storage as a media asset (Higgsfield `media_import_url`). */
  async importMediaUrl(principal: Principal, url: string, kindHint?: MediaKind): Promise<MediaAssetRow> {
    if (!/^https:\/\//.test(url)) throw new StudioError("invalid_request", "only https URLs can be imported");
    assertPublicUrl(url);
    const head = await safeFetch(url, { method: "HEAD", timeoutMs: 10_000 }).catch(() => undefined);
    const contentType = head?.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    const kind = kindHint ?? kindFromContentType(contentType);
    const { data: asset, error } = await this.db
      .from("media_assets")
      .insert({ workspace_id: principal.workspaceId, created_by: principal.userId, kind, origin: "import", status: "pending", source_url: url, content_type: contentType })
      .select("*")
      .single();
    if (error || !asset) throw new StudioError("provider_error", `could not create asset: ${error?.message}`, { status: 500 });
    await this.copyToStorage(asset, url, 30_000);
    const reloaded = await this.db.from("media_assets").select("*").eq("id", asset.id).single();
    return reloaded.data ?? asset;
  }

  /** Create a presigned upload target (Higgsfield `media_upload`); the client PUTs bytes then calls confirmUpload. */
  async createUploadTarget(principal: Principal, input: { filename: string; contentType: string; kind?: MediaKind }): Promise<{ asset_id: string; upload_url: string; method: "PUT"; headers: Record<string, string>; token: string | null; object_path: string; expires_at: string }> {
    const kind = input.kind ?? kindFromContentType(input.contentType);
    const bucket = this.storage.buckets.uploads;
    const { data: asset, error } = await this.db
      .from("media_assets")
      .insert({ workspace_id: principal.workspaceId, created_by: principal.userId, kind, origin: "upload", status: "pending", bucket, content_type: input.contentType, metadata: { filename: input.filename } as MediaAssetRow["metadata"] })
      .select("*")
      .single();
    if (error || !asset) throw new StudioError("provider_error", `could not create asset: ${error?.message}`, { status: 500 });
    const ext = extensionFor(input.contentType, input.filename);
    const objectPath = objectKey(principal.workspaceId, asset.id, ext, this.now());
    let target;
    try {
      target = await this.storage.createUploadTarget(bucket, objectPath, input.contentType);
    } catch (err) {
      throw new StudioError("provider_error", `could not sign upload: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
    }
    await this.db.from("media_assets").update({ object_path: objectPath }).eq("id", asset.id);
    return { asset_id: asset.id, upload_url: target.url, method: target.method, headers: target.headers, token: target.token ?? null, object_path: objectPath, expires_at: target.expires_at };
  }

  /** Mark an uploaded asset ready after checking the object exists (Higgsfield `media_confirm`). */
  async confirmUpload(principal: Principal, assetId: string): Promise<MediaAssetRow> {
    const { data: asset } = await this.db.from("media_assets").select("*").eq("id", assetId).eq("workspace_id", principal.workspaceId).maybeSingle();
    if (!asset) throw new StudioError("not_found", `asset ${assetId} not found`);
    if (!asset.object_path) throw new StudioError("invalid_request", "asset has no upload target");
    const backend = this.storageFor(asset.bucket);
    const stat = backend ? await backend.stat(asset.bucket, asset.object_path) : null;
    if (!stat) throw new StudioError("invalid_request", "upload not found in storage; PUT the bytes first");
    const { data: updated } = await this.db
      .from("media_assets")
      .update({ status: "ready", bytes: stat.bytes, content_type: asset.content_type ?? stat.contentType })
      .eq("id", asset.id)
      .select("*")
      .single();
    return updated ?? asset;
  }

  async listMedia(workspaceId: string, options: { kind?: MediaKind; limit?: number; before?: string; q?: string; modelId?: string } = {}): Promise<{ items: Array<MediaAssetRow & { url: string | null }>; next_cursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
    let query = this.db.from("media_assets").select("*").eq("workspace_id", workspaceId).eq("status", "ready").order("created_at", { ascending: false }).limit(limit + 1);
    if (options.kind) query = query.eq("kind", options.kind);
    if (options.modelId) query = query.eq("model_id", options.modelId);
    if (options.before) query = query.lt("created_at", options.before);
    const q = options.q?.replace(/[,()"%\\]/g, " ").replace(/\s+/g, " ").trim();
    if (q) query = query.or(`prompt.ilike.%${q}%,title.ilike.%${q}%`);
    const { data } = await query;
    const rows = (data ?? []).slice(0, limit);
    const items = await Promise.all(rows.map(async (asset) => ({ ...asset, url: await this.assetUrl(asset) })));
    return { items, next_cursor: (data?.length ?? 0) > limit ? (rows[rows.length - 1]?.created_at ?? null) : null };
  }

  /** Resolve media values (asset ids, generation ids, urls) to provider-fetchable URLs. */
  private async resolveMedias(workspaceId: string, request: NormalizedRequest, options: { allowUrls: boolean }): Promise<ResolvedMedia[]> {
    const resolved: ResolvedMedia[] = [];
    for (const media of request.medias) {
      const value = media.value.trim();
      if (/^https?:\/\//.test(value)) {
        if (!options.allowUrls) throw new StudioError("invalid_request", "pass asset ids or generation ids in medias, not URLs");
        assertPublicUrl(value);
        resolved.push({ role: media.role, kind: kindFromUrl(value), url: value, source: value });
        continue;
      }
      const { data: asset } = await this.db.from("media_assets").select("*").eq("id", value).eq("workspace_id", workspaceId).maybeSingle();
      if (asset) {
        const url = await this.assetUrl(asset);
        if (!url) throw new StudioError("media_unresolved", `asset ${value} has no readable URL`);
        resolved.push({ role: media.role, kind: assetKind(asset.kind), url, source: value });
        continue;
      }
      const { data: output } = await this.db.from("generation_outputs").select("*, generations!inner(workspace_id)").eq("generation_id", value).order("index").limit(1).maybeSingle();
      if (output) {
        const gen = (output as unknown as { generations: { workspace_id: string } }).generations;
        if (gen.workspace_id !== workspaceId) throw new StudioError("media_unresolved", `generation ${value} not found`);
        let url: string | null = null;
        if (output.asset_id) {
          const { data: outAsset } = await this.db.from("media_assets").select("*").eq("id", output.asset_id).maybeSingle();
          if (outAsset) url = await this.assetUrl(outAsset);
        }
        url = url ?? output.provider_url;
        if (!url) throw new StudioError("media_unresolved", `generation ${value} has no output yet`);
        resolved.push({ role: media.role, kind: assetKind(output.kind), url, source: value });
        continue;
      }
      throw new StudioError("media_unresolved", `media ${value} is neither an asset id nor a generation id`);
    }
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Balance
  // ---------------------------------------------------------------------------

  async balance(workspaceId: string): Promise<{ spent_usd: number; reserved_usd: number; budget_usd: number; month_to_date_usd: number; monthly_budget_usd: number | null; providers: Array<{ provider: ProviderId; native: number; unit: string; usd?: number }> }> {
    const { data } = await this.db.from("ledger_balances").select("*").eq("workspace_id", workspaceId).maybeSingle();
    const month = await this.monthToDateSpend(workspaceId);
    const providers: Array<{ provider: ProviderId; native: number; unit: string; usd?: number }> = [];
    const router = await this.routerFor(workspaceId);
    for (const id of router.availableProviders()) {
      const provider = router.getProvider(id);
      if (!provider?.getBalance) continue;
      try {
        const b = await provider.getBalance();
        if (b) providers.push({ provider: id, ...b });
      } catch {
        // ignore balance failures
      }
    }
    return { spent_usd: Number(data?.spent_usd ?? 0), reserved_usd: Number(data?.reserved_usd ?? 0), budget_usd: Number(data?.budget_usd ?? 0), month_to_date_usd: month.settled_usd, monthly_budget_usd: this.monthlyBudgetUsd > 0 ? this.monthlyBudgetUsd : null, providers };
  }

  /** Spend (settled + currently reserved) since the start of the current month (public.month_to_date_spend). */
  async monthToDateSpend(workspaceId: string): Promise<{ settled_usd: number; reserved_usd: number }> {
    const { data, error } = await this.db.rpc("month_to_date_spend", { p_workspace_id: workspaceId, p_month_start: this.monthStartIso() }).single();
    // Never fail open: a budget check without numbers must not pass.
    if (error || !data) throw new StudioError("provider_error", `could not read month-to-date spend: ${error?.message ?? "no data"}`, { status: 500 });
    const spend = data as { settled_usd: number | string; reserved_usd: number | string };
    return { settled_usd: round6(Number(spend.settled_usd)), reserved_usd: round6(Math.max(0, Number(spend.reserved_usd))) };
  }

  private monthStartIso(): string {
    const now = this.now();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  }

  /**
   * Check the monthly cap and write the reservation atomically (public.reserve_budget).
   * On refusal the pending row is failed with insufficient_credits and the error is thrown.
   */
  private async reserveBudget(row: GenerationRow, reservationUsd: number, provider: ProviderId): Promise<void> {
    const cap = this.monthlyBudgetUsd > 0 ? this.monthlyBudgetUsd : 0;
    if (cap === 0 && reservationUsd <= 0) return;
    const { data, error } = await this.db
      .rpc("reserve_budget", {
        p_workspace_id: row.workspace_id,
        p_generation_id: row.id,
        p_amount_usd: reservationUsd,
        p_cap_usd: cap,
        p_provider: provider,
        p_note: "highest known candidate estimate including fallback",
        p_month_start: this.monthStartIso(),
      })
      .single();
    const result = data as { ok: boolean; settled_usd: number | string; reserved_usd: number | string } | null;
    let failure: StudioError | null = null;
    if (error || !result) {
      failure = new StudioError("provider_error", `could not reserve budget: ${error?.message ?? "no data"}`, { status: 500 });
    } else if (!result.ok) {
      const spend = { settled_usd: round6(Number(result.settled_usd)), reserved_usd: round6(Math.max(0, Number(result.reserved_usd))) };
      failure = new StudioError("insufficient_credits", `monthly budget of $${cap.toFixed(2)} would be exceeded (spent $${spend.settled_usd.toFixed(2)}, reserved $${spend.reserved_usd.toFixed(2)}, this job about $${reservationUsd.toFixed(4)})`, {
        details: { budget_usd: cap, ...spend, estimate_usd: reservationUsd },
      });
    }
    if (!failure) return;
    await this.db
      .from("generations")
      .update({ state: "failed", error: { code: failure.code, message: failure.message }, finished_at: this.now().toISOString() })
      .eq("id", row.id)
      .in("state", NON_TERMINAL);
    throw failure;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private bindingFor(row: GenerationRow): ProviderBinding {
    const model = this.registry.get(row.model_id);
    const binding = model?.bindings.find((b) => b.provider === row.provider && b.endpoint === row.provider_endpoint) ?? model?.bindings.find((b) => b.provider === row.provider);
    if (!binding) throw new StudioError("provider_error", `no binding for ${row.model_id} at ${row.provider}`, { status: 500 });
    return binding;
  }

  private eventToStatus(event: WebhookEvent, binding: ProviderBinding): JobStatusResult {
    if (event.state === "succeeded") {
      const outputs = event.payload !== undefined ? extractOutputs(binding.output, event.payload) : [];
      if (outputs.length === 0) return { state: "running", raw: event.raw };
      const reported = event.payload !== undefined ? extractReportedCost(binding.output, event.payload) : undefined;
      const costNative = event.costNative ?? reported;
      return { state: "succeeded", outputs, costNative, costUsd: event.costUsd ?? (costNative !== undefined && binding.provider === "kie" ? costNative * KIE_USD_PER_CREDIT : undefined), raw: event.raw };
    }
    return { state: event.state, error: event.error, costNative: event.costNative, costUsd: event.costUsd, raw: event.raw };
  }

  private async reload(id: string): Promise<GenerationRow | null> {
    const { data } = await this.db.from("generations").select("*").eq("id", id).maybeSingle();
    return data;
  }

  private async toView(row: GenerationRow): Promise<GenerationView> {
    const { data: outputs } = await this.db.from("generation_outputs").select("*").eq("generation_id", row.id).order("index");
    const assetIds = (outputs ?? []).map((o) => o.asset_id).filter((id): id is string => Boolean(id));
    const assets = assetIds.length > 0 ? (await this.db.from("media_assets").select("*").in("id", assetIds)).data ?? [] : [];
    const assetById = new Map(assets.map((a) => [a.id, a] as const));
    const views = await Promise.all(
      (outputs ?? []).map(async (o) => {
        const asset = o.asset_id ? assetById.get(o.asset_id) : undefined;
        const url = asset ? await this.assetUrl(asset) : o.provider_url;
        const meta = (o.metadata ?? {}) as { width?: number | null; height?: number | null; duration_seconds?: number | null };
        return { index: o.index, kind: o.kind, asset_id: o.asset_id, url, provider_url: o.provider_url, width: asset?.width ?? meta.width ?? null, height: asset?.height ?? meta.height ?? null, duration_seconds: asset?.duration_seconds ?? meta.duration_seconds ?? null };
      }),
    );
    return {
      id: row.id,
      model_id: row.model_id,
      output_type: row.output_type,
      provider: row.provider,
      state: row.state,
      progress: row.progress,
      queue_position: row.queue_position,
      error: row.error,
      request: row.request as unknown as NormalizedRequest,
      adjustments: row.adjustments,
      cost_estimate_usd: row.cost_estimate_usd,
      cost_actual_usd: row.cost_actual_usd,
      created_at: row.created_at,
      finished_at: row.finished_at,
      outputs: views,
    };
  }

  private async ledger(workspaceId: string, generationId: string, type: "reservation" | "settlement" | "release", amountUsd: number, extra: { provider?: ProviderId; native?: number; nativeUnit?: string; note?: string } = {}): Promise<void> {
    const { error } = await this.db.from("ledger_entries").insert({
      workspace_id: workspaceId,
      generation_id: generationId,
      provider: extra.provider ?? null,
      entry_type: type,
      amount_usd: Math.round(amountUsd * 1_000_000) / 1_000_000,
      amount_native: extra.native ?? null,
      native_unit: extra.nativeUnit ?? null,
      note: extra.note ?? null,
    });
    if (error) throw new StudioError("provider_error", `could not write ${type} ledger entry: ${error.message}`, { status: 500 });
  }

  private async event(provider: ProviderId, providerJobId: string | null, generationId: string | null, kind: "webhook" | "poll" | "submit" | "cancel" | "upload", extra: { verified?: boolean; state?: JobState; payload?: unknown; httpStatus?: number } = {}): Promise<void> {
    await this.db.from("provider_events").insert({
      provider,
      provider_job_id: providerJobId,
      generation_id: generationId,
      kind,
      verified: extra.verified ?? null,
      state: extra.state ?? null,
      http_status: extra.httpStatus ?? null,
      payload: (extra.payload === undefined ? null : truncateJson(extra.payload)) as GenerationRow["provider_ref"],
    });
  }

  private async webhookUrl(providerId: ProviderId, generationId: string): Promise<string> {
    const token = await this.webhookToken(generationId);
    return `${this.baseUrl}/api/webhooks/${providerId}?g=${encodeURIComponent(generationId)}&t=${token}`;
  }

  private async webhookToken(generationId: string): Promise<string> {
    return bytesToHex(await hmacSha256(this.webhookSecret, `webhook:${generationId}`));
  }

  private async verifyWebhookToken(generationId: string, token: string): Promise<boolean> {
    try {
      const expected = await hmacSha256(this.webhookSecret, `webhook:${generationId}`);
      return timingSafeEqual(expected, hexToBytes(token));
    } catch {
      return false;
    }
  }
}

// -----------------------------------------------------------------------------

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(err: unknown): { message: string; code?: string; details?: unknown } {
  if (err instanceof StudioError) return { message: err.message, code: err.code, details: err.details };
  if (err instanceof Error) return { message: err.message };
  return { message: String(err) };
}

function truncateJson(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    if (text.length <= 20_000) return value;
    return { truncated: true, preview: text.slice(0, 20_000) };
  } catch {
    return { unserializable: true };
  }
}

function extensionFor(contentType: string, hint: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "model/gltf-binary": "glb",
  };
  const fromType = map[contentType.split(";")[0]?.trim() ?? ""];
  if (fromType) return fromType;
  const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(hint);
  return match?.[1]?.toLowerCase() ?? "bin";
}

function kindFromContentType(contentType: string): MediaKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  if (contentType.startsWith("model/")) return "model";
  return "file";
}

function kindFromUrl(url: string): ResolvedMedia["kind"] {
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext)) return "audio";
  return "image";
}

function assetKind(kind: MediaKind): ResolvedMedia["kind"] {
  return kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
}

/** Block SSRF targets (loopback, private, link-local, CGNAT, IPv6 equivalents) for user-supplied URLs. */
function assertPublicUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new StudioError("invalid_request", "invalid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new StudioError("invalid_request", "only http(s) URLs are allowed");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  const privateV6 = /^(::1$|::$|fc|fd|fe[89ab]|::ffff:)/;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || privateV4.test(host) || (host.includes(":") && privateV6.test(host))) {
    throw new StudioError("invalid_request", "URL points to a private network");
  }
}

/** fetch that re-validates every redirect hop against the SSRF guard (max 5 hops). */
async function safeFetch(url: string, init: { method?: "GET" | "HEAD"; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    assertPublicUrl(current);
    const response = await fetch(current, { method: init.method ?? "GET", headers: init.headers, redirect: "manual", signal: AbortSignal.timeout(init.timeoutMs ?? 120_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new StudioError("media_unresolved", `redirect without location from ${current}`);
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new StudioError("media_unresolved", "too many redirects");
}

export type { ModelDefinition, ProviderAdapter };
