"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { JobState, OutputType } from "@reflow/core";
import { api, errorMessage, type GenerationView } from "@/lib/client/api";
import { GENERATION_DELETE_NOTE, useDeleteGenerations } from "@/lib/client/delete";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";
import { ConfirmDeleteModal, SelectionBar, SelectToggle, useSelection, type Selection } from "@/components/ui/selection";
import { GenerationCard, GenerationCardSkeleton } from "@/components/generations/generation-card";

interface GenerationFeedProps {
  filters: { type?: OutputType; state?: JobState };
  pageSize?: number;
  onReuse?: (generation: GenerationView) => void;
  onUseAsReference?: (generation: GenerationView) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Selection owned by the page (its toolbar shows the Select toggle). Without it the feed shows its own toggle. */
  selection?: Selection;
}

export function useGenerationFeed(filters: GenerationFeedProps["filters"], pageSize: number) {
  return useInfiniteQuery({
    queryKey: ["generations", { type: filters.type ?? null, state: filters.state ?? null, pageSize }],
    queryFn: ({ pageParam }) => api.generations.list({ type: filters.type, state: filters.state, limit: pageSize, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 5_000,
  });
}

export function GenerationFeed({ filters, pageSize = 24, onReuse, onUseAsReference, emptyTitle = "Nothing generated yet", emptyDescription = "Your results will show up here, newest first.", selection: external }: GenerationFeedProps) {
  const query = useGenerationFeed(filters, pageSize);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const internal = useSelection();
  const selection = external ?? internal;
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const remove = useDeleteGenerations({
    onDeleted: (result) => {
      setConfirming(null);
      if (result.deleted.length > 0) selection.exit();
    },
  });

  if (query.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4" aria-busy>
        {Array.from({ length: 8 }).map((_, i) => (
          <GenerationCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (query.isError) {
    return <ErrorBanner title="Could not load generations" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (items.length === 0) {
    return <EmptyState icon={<Sparkles className="size-6" aria-hidden />} title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="flex flex-col gap-4">
      {external ? null : (
        <div className="flex justify-end">
          <SelectToggle selection={selection} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
        {items.map((gen) => (
          <GenerationCard
            key={gen.id}
            generation={gen}
            onReuse={onReuse}
            onUseAsReference={onUseAsReference}
            onDelete={(g) => setConfirming([g.id])}
            selectMode={selection.active}
            selected={selection.selected.has(gen.id)}
            onToggleSelect={selection.toggle}
          />
        ))}
      </div>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
      <SelectionBar selection={selection} ids={items.map((g) => g.id)} onDelete={setConfirming} deleting={remove.isPending} />
      <ConfirmDeleteModal ids={confirming} onCancel={() => setConfirming(null)} onConfirm={(ids) => remove.mutate(ids)} pending={remove.isPending} note={GENERATION_DELETE_NOTE} />
    </div>
  );
}
