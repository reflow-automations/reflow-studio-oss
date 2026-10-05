"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/client/api";
import { formatDate, formatUsd } from "@/lib/client/format";
import { useBalance } from "@/components/shell/balance-summary";
import { PageHeader } from "@/components/shell/page-header";
import { StateBadge, ProviderBadge } from "@/components/generations/state-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl leading-none">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-subtle">{hint}</p> : null}
    </div>
  );
}

export function UsageScreen() {
  const balance = useBalance();
  const recent = useQuery({ queryKey: ["generations", { usage: true }], queryFn: () => api.generations.list({ limit: 50 }), staleTime: 10_000 });
  const items = recent.data?.items ?? [];
  const totalEstimate = items.reduce((sum, g) => sum + (g.cost_estimate_usd ?? 0), 0);
  const totalActual = items.reduce((sum, g) => sum + (g.cost_actual_usd ?? 0), 0);

  return (
    <div className="flex flex-col">
      <PageHeader title="Usage" description="Ledger totals, provider balances and the last 50 generations." />
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        {balance.isPending ? (
          <div className="grid gap-3 sm:grid-cols-3" aria-busy>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : balance.isError ? (
          <ErrorBanner title="Could not load balance" message={errorMessage(balance.error)} onRetry={() => void balance.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Spent" value={formatUsd(balance.data.spent_usd, 2)} hint="Settled generations" />
            <Stat label="Reserved" value={formatUsd(balance.data.reserved_usd, 2)} hint="Held for in-flight jobs" />
            <Stat label="Budget" value={balance.data.budget_usd > 0 ? formatUsd(balance.data.budget_usd, 2) : "Unlimited"} hint={balance.data.budget_usd > 0 ? `${formatUsd(Math.max(0, balance.data.budget_usd - balance.data.spent_usd - balance.data.reserved_usd), 2)} remaining` : "MONTHLY_BUDGET_USD not set"} />
            {balance.data.providers.map((p) => (
              <Stat key={p.provider} label={`${p.provider} balance`} value={`${p.native.toLocaleString()} ${p.unit}`} hint={p.usd !== undefined ? `≈ ${formatUsd(p.usd, 2)}` : undefined} />
            ))}
          </div>
        )}

        <section aria-label="Recent generations" className="overflow-hidden rounded-lg border border-border bg-elevated">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Recent generations</h2>
            <p className="font-mono text-[11px] text-muted">
              est. {formatUsd(totalEstimate, 3)} · actual {formatUsd(totalActual, 3)}
            </p>
          </div>
          {recent.isPending ? (
            <div className="flex flex-col gap-2 p-4" aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : recent.isError ? (
            <div className="p-4">
              <ErrorBanner title="Could not load generations" message={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="No generations yet" className="m-4" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-bg text-[11px] tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Created</th>
                    <th scope="col" className="px-4 py-2 font-medium">Model</th>
                    <th scope="col" className="px-4 py-2 font-medium">Type</th>
                    <th scope="col" className="px-4 py-2 font-medium">Provider</th>
                    <th scope="col" className="px-4 py-2 font-medium">State</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Estimate</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Actual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((g) => (
                    <tr key={g.id} className="hover:bg-hover">
                      <td className="px-4 py-2 whitespace-nowrap text-muted">
                        <Link href={`/generations/${g.id}`} className="hover:text-fg hover:underline">
                          {formatDate(g.created_at)}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-mono">{g.model_id}</td>
                      <td className="px-4 py-2">{g.output_type}</td>
                      <td className="px-4 py-2">
                        <ProviderBadge provider={g.provider} />
                      </td>
                      <td className="px-4 py-2">
                        <StateBadge state={g.state} />
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{formatUsd(g.cost_estimate_usd, 4)}</td>
                      <td className="px-4 py-2 text-right font-mono">{formatUsd(g.cost_actual_usd, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
