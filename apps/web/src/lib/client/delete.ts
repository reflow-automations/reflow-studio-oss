"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, errorMessage, type DeleteResult } from "@/lib/client/api";
import { useStudioStore } from "@/lib/client/store";
import type { MediaRole } from "@reflow/core";

/** Note shown in the delete confirmation for generations. */
export const GENERATION_DELETE_NOTE = "Running generations are skipped. Generated files that another generation uses as a reference are kept under Assets.";

type Listing = { items: Array<{ id: string }> };
type Paged = { pages: Listing[]; pageParams: unknown[] };

/** Drop deleted ids from cached lists (infinite feeds and plain `{ items }` lists). */
function pruneLists(queryClient: QueryClient, prefix: string, ids: Set<string>): void {
  queryClient.setQueriesData<Paged | Listing>({ queryKey: [prefix] }, (data) => {
    if (!data) return data;
    if ("pages" in data && Array.isArray(data.pages)) return { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.filter((item) => !ids.has(item.id)) })) };
    if ("items" in data && Array.isArray(data.items)) return { ...data, items: data.items.filter((item) => !ids.has(item.id)) };
    return data;
  });
}

/** Remove deleted ids from the create drafts so the dock does not submit dangling references. */
function scrubDrafts(ids: Set<string>): void {
  const { drafts, setMedia } = useStudioStore.getState();
  for (const type of ["image", "video"] as const) {
    for (const [role, values] of Object.entries(drafts[type].medias)) {
      if (values?.some((v) => ids.has(v))) setMedia(type, role as MediaRole, values.filter((v) => !ids.has(v)));
    }
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Toast text: "Deleted 3 generations. 1 skipped: still running, cancel it first." */
export function deleteSummary(result: DeleteResult, noun: string): { message: string; tone: "success" | "error" | "info" } {
  const reasons = [...new Set(result.skipped.map((s) => (s.reason === "not_found" ? "already gone" : s.reason)))];
  const skipped = result.skipped.length > 0 ? ` ${result.skipped.length} skipped: ${reasons.join("; ")}.` : "";
  if (result.deleted.length === 0) return { message: `Nothing deleted.${skipped}`, tone: result.skipped.length > 0 ? "error" : "info" };
  return { message: `Deleted ${plural(result.deleted.length, noun)}.${skipped}`, tone: result.skipped.length > 0 ? "info" : "success" };
}

function useDelete(kind: "generations" | "media", options: { onDeleted?: (result: DeleteResult) => void } = {}) {
  const queryClient = useQueryClient();
  const notify = useStudioStore((s) => s.notify);
  return useMutation({
    mutationFn: (ids: string[]) => (kind === "generations" ? api.generations.remove(ids) : api.media.remove(ids)),
    onSuccess: (result) => {
      const gone = new Set(result.deleted);
      if (gone.size > 0) {
        pruneLists(queryClient, kind, gone);
        if (kind === "generations") for (const id of gone) queryClient.removeQueries({ queryKey: ["generation", id] });
        scrubDrafts(gone);
      }
      // Deleting generations removes their media; deleting media changes generation output urls.
      void queryClient.invalidateQueries({ queryKey: ["generations"] });
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      if (kind === "media") void queryClient.invalidateQueries({ queryKey: ["generation"] });
      const summary = deleteSummary(result, kind === "generations" ? "generation" : "item");
      notify(summary.message, summary.tone);
      options.onDeleted?.(result);
    },
    onError: (error) => notify(`Delete failed: ${errorMessage(error)}`, "error"),
  });
}

export function useDeleteGenerations(options?: { onDeleted?: (result: DeleteResult) => void }) {
  return useDelete("generations", options);
}

export function useDeleteMedia(options?: { onDeleted?: (result: DeleteResult) => void }) {
  return useDelete("media", options);
}
