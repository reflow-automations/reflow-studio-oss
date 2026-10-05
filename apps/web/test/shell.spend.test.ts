import { describe, expect, it } from "vitest";
import { spendSummary } from "@/components/shell/spend";

const base = { spent_usd: 12, reserved_usd: 0, budget_usd: 0, providers: [] };

describe("spendSummary", () => {
  it("prefers month-to-date spend and the monthly budget when the API sends them", () => {
    const s = spendSummary({ ...base, month_to_date_usd: 4, monthly_budget_usd: 10, reserved_usd: 1 });
    expect(s).toMatchObject({ spent: 4, spentLabel: "This month", reserved: 1, budget: 10, tone: "ok" });
    expect(s.usedRatio).toBeCloseTo(0.5);
  });

  it("falls back to the ledger total and budget_usd", () => {
    expect(spendSummary(base)).toMatchObject({ spent: 12, spentLabel: "Spent", budget: null, usedRatio: null, tone: "ok" });
    expect(spendSummary({ ...base, budget_usd: 20 })).toMatchObject({ budget: 20, tone: "ok" });
  });

  it("warns from 80 % of the budget (reserved counts) and turns red at the cap", () => {
    expect(spendSummary({ ...base, month_to_date_usd: 7, reserved_usd: 1, monthly_budget_usd: 10 }).tone).toBe("warning");
    expect(spendSummary({ ...base, month_to_date_usd: 9.5, reserved_usd: 1, monthly_budget_usd: 10 })).toMatchObject({ tone: "danger", usedRatio: 1 });
  });

  it("treats a zero or missing budget as unlimited and ignores negative reservations", () => {
    expect(spendSummary({ ...base, monthly_budget_usd: 0 }).budget).toBeNull();
    expect(spendSummary({ ...base, monthly_budget_usd: null }).budget).toBeNull();
    expect(spendSummary({ ...base, reserved_usd: -3 }).reserved).toBe(0);
  });
});
