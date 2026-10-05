import type { ModelDefinition, ProviderBinding, ProviderId } from "../catalog/types";
import type { ProviderAdapter, SubmitResult } from "../providers/types";
import type { NormalizedRequest, ResolvedMedia } from "../jobs/types";
import { estimateCost } from "../cost/index";
import { effectiveRequest, resolveEndpoint, resolveEndpointMode, unmappedRoles } from "../catalog/mapping";
import { isSafeToFallBack, StudioError } from "../util/errors";

export type RoutingStrategy = "cheapest" | "preferred" | "quality";

/** Default provider order for the "preferred" strategy (Kie is usually the cheapest reseller). */
export const DEFAULT_PROVIDER_PREFERENCE: readonly ProviderId[] = ["kie", "fal", "higgsfield", "mock"];

export interface RouterOptions {
  /** Provider preference order used by the "preferred" strategy and as tie-break. */
  preference?: readonly ProviderId[];
  strategy?: RoutingStrategy;
  /** Providers that must never be used (e.g. disable Kie for production). */
  disabled?: readonly ProviderId[];
}

export interface RouteCandidate {
  provider: ProviderAdapter;
  binding: ProviderBinding;
}

export interface RouteDecision extends RouteCandidate {
  /** Remaining candidates in fallback order. */
  fallbacks: RouteCandidate[];
}

export interface CandidateOptions {
  provider?: ProviderId;
  strategy?: RoutingStrategy;
  request?: NormalizedRequest;
}

export interface RoutedSubmitInput {
  request: NormalizedRequest;
  medias: ResolvedMedia[];
  jobId?: string;
  /** Webhook URL, or a function that builds one per provider. */
  webhookUrl?: string | ((provider: ProviderId) => string | undefined | Promise<string | undefined>);
}

export interface RoutedSubmission extends SubmitResult {
  provider: ProviderAdapter;
  binding: ProviderBinding;
  /** Earlier candidates that refused the job before accepting it, in order. */
  attempts: Array<{ provider: ProviderId; endpoint: string; error: unknown }>;
}

/**
 * Reasons a binding cannot serve a request (empty when it can). Checks the
 * input mode, provider-specific parameter values and that every media role in
 * the request is either mapped or deliberately ignored, so reference media are
 * never dropped silently.
 */
export function bindingRejections(binding: ProviderBinding, request: NormalizedRequest): string[] {
  const reasons: string[] = [];
  const mode = resolveEndpointMode(request.medias.filter((m) => !binding.ignoredRoles?.includes(m.role)));
  if (binding.supportedModes && !binding.supportedModes.includes(mode)) {
    reasons.push(`${mode} input is not supported (supports ${binding.supportedModes.join(", ")})`);
  }
  for (const [name, allowed] of Object.entries(binding.supportedParamValues ?? {})) {
    const value = request.params[name];
    if (value !== undefined && !allowed.includes(value as string | number | boolean)) reasons.push(`${name} ${String(value)} is not supported (supports ${allowed.join(", ")})`);
  }
  const unmapped = unmappedRoles(binding, request.medias);
  if (unmapped.length > 0) reasons.push(`cannot send media role${unmapped.length > 1 ? "s" : ""} ${unmapped.join(", ")}`);
  return reasons;
}

/** True when the binding can serve the request without dropping media or using an unsupported value. */
export function servesRequest(binding: ProviderBinding, request: NormalizedRequest): boolean {
  return bindingRejections(binding, request).length === 0;
}

/**
 * Chooses which provider binding serves a request. Only bindings whose
 * provider is configured (has credentials) and not disabled are considered,
 * and with a request only bindings that can serve it. Bindings that serve the
 * request exactly (no pinned tier, clamp or single-output downgrade) rank
 * before bindings that would adjust it; within each group the strategy decides:
 *  - preferred: follow the configured provider order, then binding priority
 *  - cheapest:  lowest estimated total for this request (ties by preference)
 *  - quality:   lowest binding.priority first (catalog authors rank by fidelity)
 * `lastResort` bindings (the offline mock) are only used when nothing else can
 * serve the request or their provider is requested explicitly.
 */
export class ProviderRouter {
  private readonly providers = new Map<ProviderId, ProviderAdapter>();
  private readonly preference: readonly ProviderId[];
  private readonly strategy: RoutingStrategy;
  private readonly disabled: Set<ProviderId>;

  constructor(providers: ProviderAdapter[], options: RouterOptions = {}) {
    for (const provider of providers) this.providers.set(provider.id, provider);
    this.preference = options.preference ?? DEFAULT_PROVIDER_PREFERENCE;
    this.strategy = options.strategy ?? "preferred";
    this.disabled = new Set(options.disabled ?? []);
  }

  getProvider(id: ProviderId): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  availableProviders(): ProviderId[] {
    return [...this.providers.values()].filter((p) => p.isConfigured() && !this.disabled.has(p.id)).map((p) => p.id);
  }

  getStrategy(): RoutingStrategy {
    return this.strategy;
  }

  private usable(id: ProviderId): ProviderAdapter | undefined {
    const provider = this.providers.get(id);
    return provider && provider.isConfigured() && !this.disabled.has(id) ? provider : undefined;
  }

  candidates(model: ModelDefinition, options: CandidateOptions = {}): RouteCandidate[] {
    const strategy = options.strategy ?? this.strategy;
    const request = options.request;
    let entries = model.bindings
      .filter((binding) => !options.provider || binding.provider === options.provider)
      .filter((binding) => !request || servesRequest(binding, request))
      .map((binding) => ({ binding, provider: this.usable(binding.provider) }))
      .filter((entry): entry is RouteCandidate => Boolean(entry.provider))
      .map((entry) => ({
        ...entry,
        exact: request ? effectiveRequest(model, entry.binding, request).exact : true,
        price: request ? (estimateCost(model, entry.binding, request)?.usd ?? Number.MAX_VALUE) : (entry.binding.pricing?.usd ?? Number.MAX_VALUE),
      }));
    if (!options.provider) {
      const regular = entries.filter((entry) => !entry.binding.lastResort);
      if (regular.length > 0) entries = regular;
    }
    const prefIndex = (id: ProviderId) => {
      const index = this.preference.indexOf(id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    entries.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (strategy === "cheapest") {
        const diff = a.price - b.price;
        if (diff !== 0) return diff > 0 ? 1 : -1;
      }
      if (strategy === "quality") {
        const diff = (a.binding.priority ?? 100) - (b.binding.priority ?? 100);
        if (diff !== 0) return diff;
      }
      const pref = prefIndex(a.binding.provider) - prefIndex(b.binding.provider);
      if (pref !== 0) return pref;
      return (a.binding.priority ?? 100) - (b.binding.priority ?? 100);
    });
    return entries.map(({ provider, binding }) => ({ provider, binding }));
  }

  route(model: ModelDefinition, options: CandidateOptions = {}): RouteDecision {
    const [first, ...rest] = this.candidates(model, options);
    if (!first) throw this.unroutable(model, options);
    return { provider: first.provider, binding: first.binding, fallbacks: rest };
  }

  /**
   * Submit through the routed candidates. Falls back to the next candidate only
   * when the error proves the provider did not accept the job
   * (`isSafeToFallBack`); an ambiguous error (the job may be queued and
   * billed) or an input error is rethrown immediately.
   */
  async submit(model: ModelDefinition, input: RoutedSubmitInput, options: Omit<CandidateOptions, "request"> = {}): Promise<RoutedSubmission> {
    const candidates = this.candidates(model, { ...options, request: input.request });
    if (candidates.length === 0) throw this.unroutable(model, { ...options, request: input.request });
    const attempts: RoutedSubmission["attempts"] = [];
    for (const candidate of candidates) {
      try {
        const webhookUrl = typeof input.webhookUrl === "function" ? await input.webhookUrl(candidate.provider.id) : input.webhookUrl;
        const result = await candidate.provider.submit({ model, binding: candidate.binding, request: input.request, medias: input.medias, webhookUrl, jobId: input.jobId });
        return { ...result, provider: candidate.provider, binding: candidate.binding, attempts };
      } catch (error) {
        attempts.push({ provider: candidate.provider.id, endpoint: candidate.binding.endpoint, error });
        if (!isSafeToFallBack(error)) throw error;
      }
    }
    throw attempts[attempts.length - 1]?.error;
  }

  /** The error `route` throws when no candidate is left, with the reasons per configured binding. */
  private unroutable(model: ModelDefinition, options: CandidateOptions): StudioError {
    const configured = this.availableProviders();
    const base = `no configured provider can serve ${model.id}${options.provider ? ` via ${options.provider}` : ""} (configured: ${configured.join(", ") || "none"})`;
    const request = options.request;
    if (!request) return new StudioError("provider_unavailable", base);
    const relevant = model.bindings.filter((binding) => !options.provider || binding.provider === options.provider);
    const blocked = relevant
      .filter((binding) => this.usable(binding.provider))
      .map((binding) => ({ provider: binding.provider, endpoint: resolveEndpoint(binding, request.medias), reasons: bindingRejections(binding, request) }))
      .filter((entry) => entry.reasons.length > 0);
    const others = [...new Set(relevant.filter((binding) => !this.usable(binding.provider) && binding.provider !== "mock" && servesRequest(binding, request)).map((binding) => binding.provider))];
    const hint = others.length > 0 ? ` A key for ${others.join(" or ")} would cover this request.` : "";
    if (blocked.length === 0) {
      return new StudioError("provider_unavailable", hint ? `${base}.${hint}` : base, { details: { blocked, providers_that_could_serve: others } });
    }
    return new StudioError("invalid_request", `${base}: ${blocked.map((entry) => `${entry.provider} ${entry.endpoint}: ${entry.reasons.join("; ")}`).join(" | ")}.${hint}`, {
      details: { blocked, providers_that_could_serve: others },
    });
  }
}
