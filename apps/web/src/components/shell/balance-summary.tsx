"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Wallet } from "lucide-react";
import { api } from "@/lib/client/api";
import { formatUsd } from "@/lib/client/format";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui/skeleton";
import { spendSummary } from "@/components/shell/spend";

export function useBalance() {
  return useQuery({ queryKey: ["balance"], queryFn: api.balance, staleTime: 30_000 });
}

// Fixed locale so server and client never disagree about digit grouping.
const nativeFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const barTone = { ok: "bg-accent", warning: "bg-warning", danger: "bg-danger" } as const;

/**
 * Spend card for the sidebar (and a compact pill for the mobile top bar).
 * Links to the Usage page for the full breakdown.
 */
export function BalanceSummary({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { data, isPending, isError } = useBalance();
  const summary = data ? spendSummary(data) : null;

  if (compact) {
    return (
      <Link
        href="/usage"
        className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-elevated px-3 text-xs font-medium text-fg-2 tabular-nums transition-colors hover:border-control hover:text-fg", className)}
        aria-label={summary ? `${summary.spentLabel}: ${formatUsd(summary.spent, 2)}. Open usage` : "Open usage"}
      >
        <Wallet className="size-3.5 text-muted" aria-hidden />
        {isPending ? <Skeleton className="h-3 w-10 rounded-xs" /> : isError || !summary ? "-" : formatUsd(summary.spent, 2)}
      </Link>
    );
  }

  return (
    <Link href="/usage" className={cn("group block rounded-md border border-border bg-elevated px-3 py-2.5 transition-colors hover:border-border-strong", className)}>
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Wallet className="size-3.5" aria-hidden />
          {summary?.spentLabel ?? "Spend"}
        </span>
        <ChevronRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
      {isPending ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      ) : isError || !summary ? (
        <p className="mt-1.5 text-xs text-danger">Spend unavailable</p>
      ) : (
        <div className="mt-1">
          <p className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-xl font-semibold text-fg">{formatUsd(summary.spent, 2)}</span>
            {summary.budget !== null ? <span className="text-xs text-muted">of {formatUsd(summary.budget, 0)}</span> : null}
          </p>
          {summary.usedRatio !== null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-hover" role="meter" aria-label="Budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.usedRatio * 100)}>
              <div className={cn("h-full rounded-full", barTone[summary.tone])} style={{ width: `${Math.max(2, summary.usedRatio * 100)}%` }} />
            </div>
          ) : null}
          <p className="mt-1.5 text-xs text-muted tabular-nums">
            {summary.reserved > 0 ? `${formatUsd(summary.reserved, 2)} reserved` : "Nothing in flight"}
            {summary.budget === null ? " · no budget cap" : ""}
          </p>
          {data && data.providers.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted tabular-nums">
              {data.providers.map((p) => (
                <li key={p.provider} className="flex items-center justify-between gap-2">
                  <span className="capitalize">{p.provider}</span>
                  <span className="text-fg-2">
                    {nativeFormat.format(p.native)} {p.unit}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Link>
  );
}
