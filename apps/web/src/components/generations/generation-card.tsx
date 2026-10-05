"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, Maximize2, Paperclip, RotateCcw } from "lucide-react";
import { api, errorMessage, type GenerationView } from "@/lib/client/api";
import { formatRelative, formatUsd, isTerminalState } from "@/lib/client/format";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/ui/media-thumb";
import { Spinner } from "@/components/ui/spinner";
import { StateBadge, ProviderBadge } from "@/components/generations/state-badge";
import { AdjustmentsHint } from "@/components/generations/adjustments-hint";

export interface GenerationCardProps {
  generation: GenerationView;
  onReuse?: (generation: GenerationView) => void;
  onUseAsReference?: (generation: GenerationView) => void;
}

/** Polls a non-terminal generation every 3 s until it settles. */
export function useLiveGeneration(initial: GenerationView): GenerationView {
  const queryClient = useQueryClient();
  const initialTerminal = isTerminalState(initial.state);
  const { data } = useQuery({
    queryKey: ["generation", initial.id],
    queryFn: () => api.generations.get(initial.id),
    enabled: !initialTerminal,
    staleTime: 0,
    retry: 2,
    refetchInterval: (query) => (query.state.data && isTerminalState(query.state.data.state) ? false : 3000),
  });
  const current = !initialTerminal && data ? data : initial;
  const settled = !initialTerminal && isTerminalState(current.state);
  useEffect(() => {
    if (!settled) return;
    void queryClient.invalidateQueries({ queryKey: ["generations"] });
    void queryClient.invalidateQueries({ queryKey: ["balance"] });
  }, [settled, queryClient]);
  return current;
}

export function aspectRatioStyle(ratio: string | undefined): string {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? "");
  return match ? `${match[1]} / ${match[2]}` : "1 / 1";
}

export function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error && typeof (error as { message: unknown }).message === "string") return (error as { message: string }).message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Failed";
  }
}

export function GenerationCard({ generation: initial, onReuse, onUseAsReference }: GenerationCardProps) {
  const queryClient = useQueryClient();
  const gen = useLiveGeneration(initial);
  const terminal = isTerminalState(gen.state);
  const cancel = useMutation({
    mutationFn: () => api.generations.cancel(gen.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(["generation", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["generations"] });
    },
  });

  const request = gen.request as { prompt?: string; aspect_ratio?: string };
  const prompt = request.prompt ?? "";
  const outputs = gen.outputs.filter((o) => o.url);
  const primary = outputs[0];
  const cost = gen.cost_actual_usd ?? gen.cost_estimate_usd;
  const failure = errorText(gen.error);

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-elevated transition-colors hover:border-border-strong" aria-label={`Generation ${gen.model_id}`}>
      <div className="relative w-full overflow-hidden bg-bg" style={{ aspectRatio: aspectRatioStyle(request.aspect_ratio) }}>
        {gen.state === "succeeded" && primary ? (
          outputs.length === 1 ? (
            <MediaThumb url={primary.url} kind={primary.kind} alt={prompt.slice(0, 80)} className="absolute inset-0 size-full" />
          ) : (
            <div className={cn("absolute inset-0 grid gap-px bg-border", outputs.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2")}>
              {outputs.slice(0, 4).map((o) => (
                <MediaThumb key={o.index} url={o.url} kind={o.kind} alt={`${prompt.slice(0, 60)} (${o.index + 1})`} className="size-full" />
              ))}
            </div>
          )
        ) : !terminal ? (
          <div className="skeleton absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-muted">
            <Spinner label={gen.state} />
            <span className="capitalize">{gen.state}</span>
            {gen.queue_position !== null && gen.queue_position !== undefined ? <span className="text-subtle">queue #{gen.queue_position}</span> : null}
            {gen.progress !== null && gen.progress > 0 ? (
              <div className="h-1 w-24 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={gen.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, gen.progress)}%` }} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted">{gen.state === "cancelled" ? "Cancelled" : (failure ?? "No output")}</div>
        )}
        <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1">
          <StateBadge state={gen.state} />
          <ProviderBadge provider={gen.provider} />
        </div>
        {!terminal ? (
          <Button size="xs" variant="danger" className="absolute top-2 right-2" onClick={() => cancel.mutate()} loading={cancel.isPending} aria-label="Cancel generation">
            <Ban className="size-3" aria-hidden /> Cancel
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5 p-2.5">
        <p className="line-clamp-2 min-h-[2.5em] text-xs text-fg" title={prompt}>
          {prompt || <span className="text-subtle">No prompt</span>}
        </p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="truncate font-mono" title={gen.model_id}>
            {gen.model_id}
          </span>
          <span className="shrink-0 font-mono" title={gen.cost_actual_usd !== null ? "actual cost" : "estimated cost"}>
            {formatUsd(cost)}
            {gen.cost_actual_usd === null && cost !== null ? "~" : ""}
          </span>
          <span className="shrink-0" title={gen.created_at}>
            {formatRelative(gen.created_at)}
          </span>
        </div>
        <AdjustmentsHint adjustments={gen.adjustments} />
        {failure && gen.state === "failed" ? (
          <p className="line-clamp-2 text-[11px] text-danger" title={failure}>
            {failure}
          </p>
        ) : null}
        {cancel.isError ? <p className="text-[11px] text-danger">{errorMessage(cancel.error)}</p> : null}
        <div className="flex items-center gap-0.5">
          {onReuse ? (
            <Button icon size="sm" variant="ghost" title="Reuse prompt & settings" aria-label="Reuse prompt and settings" onClick={() => onReuse(gen)}>
              <RotateCcw className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          {onUseAsReference ? (
            <Button icon size="sm" variant="ghost" title="Use as reference" aria-label="Use as reference" disabled={gen.state !== "succeeded" || !primary} onClick={() => onUseAsReference(gen)}>
              <Paperclip className="size-3.5" aria-hidden />
            </Button>
          ) : null}
          {primary?.url ? (
            <a href={primary.url} target="_blank" rel="noreferrer" download title="Download" aria-label="Download output" className="inline-flex size-7 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-fg">
              <Download className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <Link href={`/generations/${gen.id}`} title="Open details" aria-label="Open details" className="ml-auto inline-flex size-7 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-fg">
            <Maximize2 className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function GenerationCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-elevated" aria-hidden>
      <div className="skeleton aspect-square w-full" />
      <div className="flex flex-col gap-2 p-2.5">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}
