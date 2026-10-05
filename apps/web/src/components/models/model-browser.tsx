"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Search } from "lucide-react";
import type { Capability, OutputType, PublicModel } from "@reflow/core";
import { api, errorMessage } from "@/lib/client/api";
import { humanize } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import { useStudioStore } from "@/lib/client/store";
import { ProviderPriceBadges } from "@/components/create/model-picker";
import { PageHeader } from "@/components/shell/page-header";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";

const CAPABILITIES: Capability[] = [
  "text-to-image",
  "image-to-image",
  "image-edit",
  "inpaint",
  "outpaint",
  "upscale-image",
  "background-removal",
  "text-to-video",
  "image-to-video",
  "first-last-frame-to-video",
  "reference-to-video",
  "video-to-video",
  "video-edit",
  "video-extension",
  "motion-control",
  "lipsync",
  "upscale-video",
  "reframe-video",
  "video-background-removal",
  "text-to-speech",
  "voice-clone",
  "text-to-music",
  "text-to-sfx",
  "image-to-3d",
  "text-to-3d",
];

const TYPES: OutputType[] = ["image", "video", "audio", "3d"];

function ModelCard({ model }: { model: PublicModel }) {
  const setModel = useStudioStore((s) => s.setModel);
  const createHref: Route | null = model.output_type === "image" ? "/create/image" : model.output_type === "video" ? "/create/video" : null;
  const durations = model.durations ? model.durations.map((d) => `${d}s`).join(", ") : model.duration_range ? `${model.duration_range.min}–${model.duration_range.max}s` : null;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{model.name}</h2>
          <p className="text-xs text-muted">
            {model.vendor} · <span className="font-mono">{model.id}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Badge tone="accent">{model.output_type}</Badge>
          {model.status !== "active" ? <Badge tone={model.status === "beta" ? "info" : "warning"}>{model.status}</Badge> : null}
        </div>
      </div>
      <p className="text-xs leading-snug text-muted">{model.description}</p>
      <ul className="flex flex-wrap gap-1" aria-label="Capabilities">
        {model.capabilities.map((c) => (
          <li key={c}>
            <Badge tone="outline">{c}</Badge>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-subtle">Ratios</dt>
        <dd className="font-mono text-muted">{model.aspect_ratios.length ? model.aspect_ratios.join(" ") : "—"}</dd>
        {durations ? (
          <>
            <dt className="text-subtle">Durations</dt>
            <dd className="font-mono text-muted">{durations}</dd>
          </>
        ) : null}
        {model.medias.length ? (
          <>
            <dt className="text-subtle">Inputs</dt>
            <dd className="text-muted">{model.medias.map((m) => `${humanize(m.role)}${m.max && m.max > 1 ? ` ×${m.max}` : ""}${m.required ? " (required)" : ""}`).join(", ")}</dd>
          </>
        ) : null}
        {model.parameters.length ? (
          <>
            <dt className="text-subtle">Params</dt>
            <dd className="font-mono text-muted">{model.parameters.map((p) => p.name).join(", ")}</dd>
          </>
        ) : null}
        {model.higgsfield_ids?.length ? (
          <>
            <dt className="text-subtle">Replaces</dt>
            <dd className="font-mono text-muted">{model.higgsfield_ids.join(", ")}</dd>
          </>
        ) : null}
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <ProviderPriceBadges model={model} />
        {createHref ? (
          <Link href={createHref} onClick={() => setModel(model.output_type as "image" | "video", model.id)} className="text-xs font-medium text-accent hover:underline">
            Use in studio →
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function ModelBrowser() {
  const [q, setQ] = useState("");
  const [type, setType] = useState<OutputType | "">("");
  const [capability, setCapability] = useState<Capability | "">("");
  const dq = useDebouncedValue(q.trim(), 250);
  const query = useQuery({
    queryKey: ["models", { q: dq, type: type || null, capability: capability || null }],
    queryFn: () => api.models.list({ q: dq || undefined, type: type || undefined, capability: capability || undefined, limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const items = query.data?.items ?? [];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Models"
        description={query.data ? `${query.data.total} model${query.data.total === 1 ? "" : "s"} in the catalog` : "Catalog of routed models with per-provider pricing."}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
              <Input type="search" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" className="w-56 pl-8" />
            </div>
            <Select aria-label="Output type" value={type} onChange={(e) => setType(e.target.value as OutputType | "")} className="w-32">
              <option value="">All types</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select aria-label="Capability" value={capability} onChange={(e) => setCapability(e.target.value as Capability | "")} className="w-48">
              <option value="">Any capability</option>
              {CAPABILITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="p-4 sm:p-6">
        {query.isPending ? (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-busy>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorBanner title="Could not load models" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Boxes className="size-6" aria-hidden />} title="No models match" description="Loosen the filters or search for a vendor, capability or Higgsfield id." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((m) => (
              <ModelCard key={m.id} model={m} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
