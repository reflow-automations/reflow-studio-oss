import "server-only";
import type { ProviderRouter } from "@reflow/core";

/**
 * Per-workspace router cache. Routers are rebuilt when provider keys or the
 * provider preference change (explicit invalidation) and after a short TTL so
 * other serverless instances pick up changes too.
 */
const ROUTER_TTL_MS = 60_000;

interface Entry {
  router: ProviderRouter;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function getCachedRouter(workspaceId: string, now = Date.now()): ProviderRouter | undefined {
  const entry = cache.get(workspaceId);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(workspaceId);
    return undefined;
  }
  return entry.router;
}

export function setCachedRouter(workspaceId: string, router: ProviderRouter, now = Date.now()): void {
  cache.set(workspaceId, { router, expiresAt: now + ROUTER_TTL_MS });
}

/** Drop the cached router for one workspace (or all). */
export function invalidateRouter(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}
