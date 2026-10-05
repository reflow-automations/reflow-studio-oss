import type { JobState, ProviderId } from "@reflow/core";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const tones: Record<JobState, BadgeTone> = {
  pending: "neutral",
  queued: "info",
  running: "accent",
  succeeded: "success",
  failed: "danger",
  cancelled: "warning",
};

export function StateBadge({ state }: { state: JobState }) {
  return <Badge tone={tones[state]}>{state}</Badge>;
}

export function ProviderBadge({ provider }: { provider: ProviderId | null | undefined }) {
  if (!provider) return null;
  return (
    <Badge tone="outline" className="font-mono">
      {provider}
    </Badge>
  );
}
