import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import type { GenerationView } from "@/lib/client/api";
import { formatDate, formatUsd, isTerminalState } from "@/lib/client/format";
import { MediaThumb } from "@/components/ui/media-thumb";
import { Badge } from "@/components/ui/badge";
import { StateBadge, ProviderBadge } from "@/components/generations/state-badge";
import { AdjustmentsHint, asAdjustments } from "@/components/generations/adjustments-hint";
import { aspectRatioStyle, errorText } from "@/components/generations/generation-card";
import { AutoRefresh, RerunButton } from "@/components/generations/generation-detail-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-mono break-all text-fg">{children}</dd>
    </div>
  );
}

export function GenerationDetail({ generation: gen }: { generation: GenerationView }) {
  const request = gen.request as { prompt?: string; aspect_ratio?: string };
  const failure = errorText(gen.error);
  const terminal = isTerminalState(gen.state);
  const adjustments = asAdjustments(gen.adjustments);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/library" className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" aria-label="Back to library">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">{gen.model_id}</h1>
            <p className="truncate font-mono text-[11px] text-subtle">{gen.id}</p>
          </div>
          <StateBadge state={gen.state} />
          <ProviderBadge provider={gen.provider} />
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh active={!terminal} />
          <RerunButton generation={gen} />
        </div>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-label="Outputs" className="flex flex-col gap-4">
          {gen.outputs.length === 0 ? (
            <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted" style={{ aspectRatio: aspectRatioStyle(request.aspect_ratio) }}>
              {terminal ? (failure ?? "No outputs") : `${gen.state}${gen.progress ? ` · ${gen.progress}%` : ""}${gen.queue_position !== null ? ` · queue #${gen.queue_position}` : ""}`}
            </div>
          ) : (
            gen.outputs.map((o) => (
              <figure key={o.index} className="overflow-hidden rounded-lg border border-border bg-elevated">
                <MediaThumb url={o.url} kind={o.kind} controls alt={`${request.prompt?.slice(0, 80) ?? "output"} (${o.index + 1})`} className="max-h-[75vh] w-full" />
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted">
                  <span className="font-mono">
                    #{o.index + 1} · {o.kind}
                    {o.width && o.height ? ` · ${o.width}×${o.height}` : ""}
                    {o.duration_seconds ? ` · ${o.duration_seconds}s` : ""}
                  </span>
                  {o.url ? (
                    <a href={o.url} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 text-fg hover:underline">
                      <Download className="size-3.5" aria-hidden /> Download
                    </a>
                  ) : null}
                </figcaption>
              </figure>
            ))
          )}
          {failure && gen.state === "failed" ? (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {failure}
            </p>
          ) : null}
          {request.prompt ? (
            <div className="rounded-lg border border-border bg-elevated p-3">
              <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Prompt</p>
              <p className="text-sm whitespace-pre-wrap">{request.prompt}</p>
            </div>
          ) : null}
        </section>

        <aside className="flex flex-col gap-4">
          <dl className="divide-y divide-border rounded-lg border border-border bg-elevated px-3">
            <Row label="Output">{gen.output_type}</Row>
            <Row label="Provider">{gen.provider ?? "—"}</Row>
            <Row label="Estimate">{formatUsd(gen.cost_estimate_usd, 4)}</Row>
            <Row label="Actual">{formatUsd(gen.cost_actual_usd, 4)}</Row>
            <Row label="Created">{formatDate(gen.created_at)}</Row>
            <Row label="Finished">{formatDate(gen.finished_at)}</Row>
            {gen.progress !== null ? <Row label="Progress">{gen.progress}%</Row> : null}
          </dl>

          <div className="rounded-lg border border-border bg-elevated p-3">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">
              Adjustments <Badge className="ml-1">{adjustments.length}</Badge>
            </p>
            {adjustments.length === 0 ? <p className="text-xs text-subtle">The request was used as-is.</p> : <AdjustmentsHint adjustments={gen.adjustments} verbose />}
          </div>

          <div className="rounded-lg border border-border bg-elevated p-3">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">Request</p>
            <pre className="max-h-96 overflow-auto rounded-md bg-bg p-2 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(gen.request, null, 2)}</pre>
          </div>
        </aside>
      </div>
    </div>
  );
}
