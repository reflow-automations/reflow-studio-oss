"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { JobState, OutputType } from "@reflow/core";
import type { GenerationView } from "@/lib/client/api";
import { useStudioStore } from "@/lib/client/store";
import { PageHeader } from "@/components/shell/page-header";
import { Select } from "@/components/ui/input";
import { GenerationFeed } from "@/components/generations/generation-feed";

const TYPES: Array<{ value: OutputType | ""; label: string }> = [
  { value: "", label: "All types" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "3d", label: "3D" },
];

const STATES: Array<{ value: JobState | ""; label: string }> = [
  { value: "", label: "All states" },
  { value: "pending", label: "Pending" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

/** Reuse a generation's request on the matching create screen. */
export function useReuseGeneration() {
  const router = useRouter();
  const prefill = useStudioStore((s) => s.prefill);
  const notify = useStudioStore((s) => s.notify);
  return (gen: GenerationView) => {
    if (gen.output_type !== "image" && gen.output_type !== "video") {
      notify("Only image and video generations can be re-run from the studio.", "error");
      return;
    }
    prefill(gen.output_type, gen.request);
    const href: Route = gen.output_type === "image" ? "/create/image" : "/create/video";
    router.push(href);
  };
}

export function LibraryScreen() {
  const [type, setType] = useState<OutputType | "">("");
  const [state, setState] = useState<JobState | "">("");
  const reuse = useReuseGeneration();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Library"
        description="Every generation in this workspace."
        actions={
          <>
            <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as OutputType | "")} className="w-36">
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by state" value={state} onChange={(e) => setState(e.target.value as JobState | "")} className="w-36">
              {STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="p-4 sm:p-6">
        <GenerationFeed filters={{ type: type || undefined, state: state || undefined }} pageSize={36} onReuse={reuse} emptyTitle="No generations match" emptyDescription="Try another filter or create something new." />
      </div>
    </div>
  );
}
