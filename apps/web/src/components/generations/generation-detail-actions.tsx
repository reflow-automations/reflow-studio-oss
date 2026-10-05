"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import type { GenerationView } from "@/lib/client/api";
import { isTerminalState } from "@/lib/client/format";
import { GENERATION_DELETE_NOTE, useDeleteGenerations } from "@/lib/client/delete";
import { ConfirmDeleteModal } from "@/components/ui/selection";
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

/** Delete this generation (after confirmation), then go back to the library. */
export function DeleteGenerationButton({ generation }: { generation: GenerationView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const remove = useDeleteGenerations({
    onDeleted: (result) => {
      setConfirming(null);
      if (result.deleted.includes(generation.id)) router.push("/library");
    },
  });
  const terminal = isTerminalState(generation.state);
  return (
    <>
      <Button variant="danger" onClick={() => setConfirming([generation.id])} disabled={!terminal} title={terminal ? undefined : "Cancel it first to delete"}>
        <Trash2 className="size-3.5" aria-hidden /> Delete
      </Button>
      <ConfirmDeleteModal ids={confirming} onCancel={() => setConfirming(null)} onConfirm={(ids) => remove.mutate(ids)} pending={remove.isPending} note={GENERATION_DELETE_NOTE} />
    </>
  );
}
