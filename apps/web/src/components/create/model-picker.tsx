"use client";

import { useMemo } from "react";
import { BadgeCheck } from "lucide-react";
import type { PublicModel } from "@reflow/core";
import { errorMessage } from "@/lib/client/api";
import { unitLabel } from "@/lib/client/format";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/banner";

interface ModelPickerProps {
  models: PublicModel[];
  model: PublicModel | null;
  onChange: (modelId: string) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ProviderPriceBadges({ model, className }: { model: PublicModel; className?: string }) {
  return (
    <ul className={className ?? "flex flex-wrap gap-1"} aria-label="Providers and prices">
      {model.providers.map((p) => (
        <li key={`${p.provider}:${p.endpoint}`}>
          <Badge tone={p.verified ? "success" : "neutral"} title={`${p.endpoint}${p.pricing?.notes ? ` — ${p.pricing.notes}` : ""}${p.verified ? " (verified)" : ""}`}>
            <span className="font-mono">{p.provider}</span>
            <span>{p.pricing ? `$${p.pricing.usd}${unitLabel(p.pricing.unit)}` : "n/a"}</span>
            {p.verified ? <BadgeCheck className="size-3" aria-label="verified" /> : null}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function ModelPicker({ models, model, onChange, loading, error, onRetry }: ModelPickerProps) {
  const groups = useMemo(() => {
    const byVendor = new Map<string, PublicModel[]>();
    for (const m of models) (byVendor.get(m.vendor) ?? byVendor.set(m.vendor, []).get(m.vendor))!.push(m);
    return [...byVendor.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  return (
    <Field label="Model" htmlFor="model-select">
      {loading ? (
        <Skeleton className="h-8 w-full" />
      ) : error ? (
        <ErrorBanner title="Could not load models" message={errorMessage(error)} onRetry={onRetry} />
      ) : models.length === 0 ? (
        <p className="text-xs text-muted">No models available for this output type.</p>
      ) : (
        <Select id="model-select" value={model?.id ?? ""} onChange={(e) => onChange(e.target.value)}>
          {groups.map(([vendor, items]) => (
            <optgroup key={vendor} label={vendor}>
              {items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.status === "beta" ? " (beta)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
      {model ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs leading-snug text-muted">{model.description}</p>
          <ProviderPriceBadges model={model} />
        </div>
      ) : null}
    </Field>
  );
}
