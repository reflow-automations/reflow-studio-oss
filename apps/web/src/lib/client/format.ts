import type { JobState } from "@reflow/core";

export function formatUsd(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value === 0) return "$0";
  if (Math.abs(value) < 0.001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(digits)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((now - t) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86_400)}d ago`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Turn a snake_case identifier into a readable label. */
export function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function unitLabel(unit: string): string {
  switch (unit) {
    case "image":
      return "/image";
    case "second":
      return "/s";
    case "minute":
      return "/min";
    case "megapixel":
      return "/MP";
    case "generation":
      return "/run";
    case "thousand_chars":
      return "/1k chars";
    default:
      return `/${unit}`;
  }
}

export function isTerminalState(state: JobState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
