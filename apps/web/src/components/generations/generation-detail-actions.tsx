"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw } from "lucide-react";
import type { GenerationView } from "@/lib/client/api";
import { useReuseGeneration } from "@/components/library/library-screen";
import { Button } from "@/components/ui/button";

export function RerunButton({ generation }: { generation: GenerationView }) {
  const reuse = useReuseGeneration();
  return (
    <Button variant="primary" onClick={() => reuse(generation)} disabled={generation.output_type !== "image" && generation.output_type !== "video"}>
      <RotateCcw className="size-3.5" aria-hidden /> Re-run in studio
    </Button>
  );
}

/** Re-renders the server page every 3 s while the generation is still in flight. */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return (
    <Button variant="outline" onClick={() => router.refresh()}>
      <RefreshCw className="size-3.5" aria-hidden /> Refresh
    </Button>
  );
}
