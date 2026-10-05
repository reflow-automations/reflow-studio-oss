import "server-only";
import { env } from "@/lib/env";
import { encryptionConfigured, getProviderPreference, listProviderKeys, type ProviderKeyView, type ProviderPreference } from "@/lib/settings/provider-keys";
import { describeStorage, type StorageInfo } from "@/lib/storage";
import { getStudio } from "@/lib/studio";

export interface StudioStatus {
  providers: ProviderKeyView[];
  provider_preference: ProviderPreference;
  storage: StorageInfo;
  encryption_configured: boolean;
  monthly_budget_usd: number | null;
  month_to_date_usd: number;
  reserved_usd: number;
  mock_provider_enabled: boolean;
}

/** Configuration overview shared by the REST `/api/v1/status` route, the MCP `studio_status` tool and Settings → Providers. */
export async function studioStatus(workspaceId: string): Promise<StudioStatus> {
  const e = env();
  const [providers, preference, month] = await Promise.all([listProviderKeys(workspaceId), getProviderPreference(workspaceId), getStudio().monthToDateSpend(workspaceId)]);
  return {
    providers,
    provider_preference: preference,
    storage: describeStorage(),
    encryption_configured: encryptionConfigured(),
    monthly_budget_usd: e.MONTHLY_BUDGET_USD && e.MONTHLY_BUDGET_USD > 0 ? e.MONTHLY_BUDGET_USD : null,
    month_to_date_usd: month.settled_usd,
    reserved_usd: month.reserved_usd,
    mock_provider_enabled: Boolean(e.ENABLE_MOCK_PROVIDER),
  };
}
