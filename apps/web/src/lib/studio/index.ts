import "server-only";
import { appBaseUrl, env } from "@/lib/env";
import { getStorage, getStorageBackends } from "@/lib/storage";
import { getRegistry, routerFor } from "@/lib/studio/providers";
import { StudioService } from "@/lib/studio/service";
import { supabaseAdmin } from "@/lib/supabase/admin";

let cached: StudioService | undefined;

/**
 * Process-wide StudioService. Provider routers are resolved per workspace on
 * each call (keys live in the database), storage is R2 when configured.
 */
export function getStudio(): StudioService {
  if (cached) return cached;
  const [storage, ...readStorages] = getStorageBackends();
  cached = new StudioService({
    db: supabaseAdmin(),
    registry: getRegistry(),
    router: routerFor,
    storage: storage ?? getStorage(),
    readStorages,
    baseUrl: appBaseUrl(),
    webhookSecret: env().WEBHOOK_SECRET,
    monthlyBudgetUsd: env().MONTHLY_BUDGET_USD,
  });
  return cached;
}

export type { StudioService, GenerationView, Principal } from "@/lib/studio/service";
