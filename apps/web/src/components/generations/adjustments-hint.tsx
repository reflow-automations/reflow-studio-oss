import { TriangleAlert } from "lucide-react";
import type { Adjustment } from "@reflow/core";

export function asAdjustments(value: unknown): Adjustment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is Adjustment => Boolean(a) && typeof a === "object" && "field" in (a as object));
}

function show(value: unknown): string {
  if (value === undefined) return "unset";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function AdjustmentsHint({ adjustments, verbose = false }: { adjustments: unknown; verbose?: boolean }) {
  const list = asAdjustments(adjustments);
  if (list.length === 0) return null;
  const summary = list.map((a) => `${a.field}: ${show(a.from)} → ${show(a.to)} (${a.reason})`);
  if (verbose) {
    return (
      <ul className="flex flex-col gap-1 text-xs text-warning">
        {summary.map((line) => (
          <li key={line} className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="break-words">{line}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[11px] text-warning" title={summary.join("\n")}>
      <TriangleAlert className="size-3 shrink-0" aria-hidden />
      <span className="truncate">
        {list.length} adjustment{list.length > 1 ? "s" : ""}: {list[0].field} → {show(list[0].to)}
      </span>
    </p>
  );
}
