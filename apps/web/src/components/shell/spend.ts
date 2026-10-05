import type { Balance } from "@/lib/client/api";

/** The balance route also returns month-to-date figures; read them when present. */
export type BalanceWithMonth = Balance & { month_to_date_usd?: number; monthly_budget_usd?: number | null };

export interface SpendSummary {
  /** Spend shown as the headline number (month to date when known, else the ledger total). */
  spent: number;
  /** "This month" or "Spent". */
  spentLabel: string;
  reserved: number;
  /** Monthly cap in USD, or null when unlimited. */
  budget: number | null;
  /** Spent plus reserved as a fraction of the budget (0 to 1, clamped), or null without a budget. */
  usedRatio: number | null;
  /** warning from 80 % of the budget, danger at or above it. */
  tone: "ok" | "warning" | "danger";
}

/** View model for the sidebar spend card. Pure, so the thresholds are unit tested. */
export function spendSummary(balance: BalanceWithMonth): SpendSummary {
  const monthly = typeof balance.month_to_date_usd === "number" && Number.isFinite(balance.month_to_date_usd);
  const spent = monthly ? (balance.month_to_date_usd as number) : balance.spent_usd;
  const budgetRaw = balance.monthly_budget_usd ?? (balance.budget_usd > 0 ? balance.budget_usd : null);
  const budget = budgetRaw !== null && budgetRaw > 0 ? budgetRaw : null;
  const reserved = Math.max(0, balance.reserved_usd);
  const used = spent + reserved;
  const usedRatio = budget === null ? null : Math.min(1, Math.max(0, used / budget));
  const tone = budget === null ? "ok" : used >= budget ? "danger" : used >= budget * 0.8 ? "warning" : "ok";
  return { spent, spentLabel: monthly ? "This month" : "Spent", reserved, budget, usedRatio, tone };
}
