"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Coins } from "lucide-react";
import { api, errorMessage, type GenerateBody } from "@/lib/client/api";
import { formatUsd } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import { Skeleton } from "@/components/ui/skeleton";
import { AdjustmentsHint } from "@/components/generations/adjustments-hint";

interface CostEstimateProps {
  body: GenerateBody | null;
  enabled: boolean;
}

export function CostEstimate({ body, enabled }: CostEstimateProps) {
  const key = useDebouncedValue(body ? JSON.stringify(body) : "", 400);
  const query = useQuery({
    queryKey: ["estimate", key],
    queryFn: () => api.generations.estimate(JSON.parse(key) as GenerateBody),
    enabled: enabled && key !== "",
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const estimates = [...(query.data?.estimates ?? [])].sort((a, b) => a.usd - b.usd);
  const cheapest = estimates[0];

  return (
    <section className="rounded-md border border-border bg-bg p-3" aria-live="polite" aria-label="Cost estimate">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
          <Coins className="size-3.5" aria-hidden /> Estimated cost
        </span>
        {query.isFetching ? <Skeleton className="h-3 w-12" /> : null}
      </div>
      {!enabled || key === "" ? (
        <p className="mt-1.5 text-xs text-subtle">Complete the required fields to see an estimate.</p>
      ) : query.isPending ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-40" />
        </div>
      ) : query.isError ? (
        <p className="mt-1.5 text-xs text-danger">Estimate unavailable: {errorMessage(query.error)}</p>
      ) : !cheapest ? (
        <p className="mt-1.5 text-xs text-muted">No priced provider can serve this request.</p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg leading-none text-fg">{formatUsd(cheapest.usd, 4)}</span>
            <span className="text-xs text-muted">
              cheapest via <span className="font-mono text-fg">{cheapest.provider}</span>
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {estimates.map((e) => (
              <li key={`${e.provider}:${e.endpoint}`} className="flex items-start justify-between gap-2 text-[11px] text-muted">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span className="font-mono text-fg">{e.provider}</span>
                  {e.verified ? <BadgeCheck className="size-3 text-success" aria-label="verified price" /> : null}
                  <span className="truncate" title={e.breakdown}>
                    {e.breakdown}
                  </span>
                </span>
                <span className="shrink-0 font-mono">{formatUsd(e.usd, 4)}</span>
              </li>
            ))}
          </ul>
          <AdjustmentsHint adjustments={query.data?.request.adjustments} />
        </div>
      )}
    </section>
  );
}
