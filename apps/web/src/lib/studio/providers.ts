import "server-only";
import {
  createMockProvider,
  DEFAULT_PROVIDER_PREFERENCE,
  FalProvider,
  HiggsfieldProvider,
  isPaidProviderId,
  isProviderId,
  KieProvider,
  ModelRegistry,
  ProviderRouter,
  withMockBindings,
  type MockProvider,
  type ProviderAdapter,
  type ProviderId,
  type RoutingStrategy,
} from "@reflow/core";
import { SEED_MODELS } from "@reflow/core/catalog/models";
import { env } from "@/lib/env";
import { getProviderPreference, resolveProviderSecrets, type ProviderPreference } from "@/lib/settings/provider-keys";
import { getCachedRouter, setCachedRouter } from "@/lib/studio/router-cache";

let registry: ModelRegistry | undefined;
let envRouterCache: ProviderRouter | undefined;
let mockProvider: MockProvider | undefined;

/**
 * ENABLE_MOCK_PROVIDER=true (demo mode): every model gets a free, last-resort
 * mock binding, so configured paid keys always win and a fresh deployment can
 * generate placeholder outputs without any provider key.
 */
function mockEnabled(): boolean {
  return env().ENABLE_MOCK_PROVIDER;
}

/** One stateless (simulated) mock per process: jobs are timed, not stored, so any instance can answer a poll. */
function getMockProvider(): MockProvider {
  if (!mockProvider) mockProvider = createMockProvider();
  return mockProvider;
}

/** Model registry (seed catalog, plus mock bindings in demo mode). */
export function getRegistry(): ModelRegistry {
  if (!registry) registry = new ModelRegistry(mockEnabled() ? withMockBindings(SEED_MODELS) : SEED_MODELS);
  return registry;
}

function buildRouter(secrets: { fal?: string; kie?: string; higgsfield?: string }, preference: ProviderPreference | undefined): ProviderRouter {
  const e = env();
  const providers: ProviderAdapter[] = [new FalProvider({ apiKey: secrets.fal }), new KieProvider({ apiKey: secrets.kie, webhookSecret: e.KIE_WEBHOOK_SECRET }), new HiggsfieldProvider({ credential: secrets.higgsfield })];
  if (e.ENABLE_MOCK_PROVIDER || process.env.NODE_ENV === "test") providers.push(getMockProvider());
  const configured = e.PROVIDER_PREFERENCE?.split(",").map((p) => p.trim()).filter(isProviderId);
  const envPreference: ProviderId[] = configured?.length ? configured : [...DEFAULT_PROVIDER_PREFERENCE];
  let strategy: RoutingStrategy = e.PROVIDER_STRATEGY ?? "preferred";
  let order: ProviderId[] = envPreference;
  if (preference === "cheapest") strategy = "cheapest";
  else if (preference && isPaidProviderId(preference)) {
    strategy = "preferred";
    order = [preference, ...envPreference.filter((p) => p !== preference)];
  }
  return new ProviderRouter(providers, { preference: order, strategy });
}

/** Router built from environment variables only (webhook parsing before the workspace is known; tests). */
export function getEnvRouter(): ProviderRouter {
  if (!envRouterCache) {
    const e = env();
    envRouterCache = buildRouter({ fal: e.FAL_KEY, kie: e.KIE_API_KEY, higgsfield: e.HIGGSFIELD_API_CREDENTIAL }, e.PROVIDER_STRATEGY === "cheapest" ? "cheapest" : undefined);
  }
  return envRouterCache;
}

/**
 * Router for a workspace: provider keys saved in Settings → Providers (with
 * environment fallback) and the workspace's provider preference. Cached
 * briefly; invalidated when keys or the preference change.
 */
export async function routerFor(workspaceId: string | null): Promise<ProviderRouter> {
  if (!workspaceId) return getEnvRouter();
  const cached = getCachedRouter(workspaceId);
  if (cached) return cached;
  const [secrets, preference] = await Promise.all([resolveProviderSecrets(workspaceId), getProviderPreference(workspaceId)]);
  const router = buildRouter(secrets, preference);
  setCachedRouter(workspaceId, router);
  return router;
}
