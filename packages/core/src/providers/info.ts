import { PROVIDER_IDS, type ProviderId } from "../catalog/types";
import { KIE_USD_PER_CREDIT } from "./kie/index";

/** Static facts about a provider that hosts need for settings screens, cost settlement and docs. */
export interface ProviderInfo {
  id: ProviderId;
  /** Human-readable name. */
  label: string;
  /** Environment variable a host can read the credential from (none for the mock). */
  envVar?: string;
  /** Where a user creates the key. */
  keyUrl?: string;
  /** True when jobs cost real money. */
  paid: boolean;
  /** Native billing unit when it is not USD (Kie credits). */
  nativeUnit?: { unit: string; usdPerUnit: number };
  /** True when finished jobs report the amount actually billed (Kie credits). */
  reportsBilledCost: boolean;
  /**
   * Without a reported amount, the catalog estimate is close enough to book as
   * the actual cost. False when estimates are only provisional quotes
   * (Higgsfield bills by output dimensions and running promotions).
   */
  estimateSettles: boolean;
}

/**
 * One entry per id in `PROVIDER_IDS` (the `Record` type makes a missing entry
 * a compile error). Adding a provider: an adapter under `providers/<id>/`, the
 * id in `PROVIDER_IDS`, an entry here, plus the database enum migration.
 */
export const PROVIDER_INFO: Readonly<Record<ProviderId, ProviderInfo>> = {
  fal: { id: "fal", label: "fal.ai", envVar: "FAL_KEY", keyUrl: "https://fal.ai/dashboard/keys", paid: true, reportsBilledCost: false, estimateSettles: true },
  kie: { id: "kie", label: "Kie.ai", envVar: "KIE_API_KEY", keyUrl: "https://kie.ai/api-key", paid: true, nativeUnit: { unit: "credits", usdPerUnit: KIE_USD_PER_CREDIT }, reportsBilledCost: true, estimateSettles: true },
  higgsfield: { id: "higgsfield", label: "Higgsfield API", envVar: "HIGGSFIELD_API_CREDENTIAL", keyUrl: "https://console.higgsfield.ai", paid: true, reportsBilledCost: false, estimateSettles: false },
  mock: { id: "mock", label: "Offline demo (mock)", paid: false, reportsBilledCost: true, estimateSettles: true },
};

/** `PROVIDER_INFO` in `PROVIDER_IDS` order. */
export function listProviderInfo(): ProviderInfo[] {
  return PROVIDER_IDS.map((id) => PROVIDER_INFO[id]);
}
