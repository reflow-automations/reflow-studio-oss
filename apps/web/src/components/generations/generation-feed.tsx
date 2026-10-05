"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { JobState, OutputType } from "@reflow/core";
import { api, errorMessage, type GenerationView } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";
import { GenerationCard, GenerationCardSkeleton } from "@/components/generations/generation-card";

interface GenerationFeedProps {
  filters: { type?: OutputType; state?: JobState };
  pageSize?: number;
  onReuse?: (generation: GenerationView) => void;
  onUseAsReference?: (generation: GenerationView) => void;
  emptyTitle?: string;
  emptyDescription?: string;
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

export function GenerationFeed({ filters, pageSize = 24, onReuse, onUseAsReference, emptyTitle = "Nothing generated yet", emptyDescription = "Your results will show up here, newest first." }: GenerationFeedProps) {
  const query = useGenerationFeed(filters, pageSize);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

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
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
        {items.map((gen) => (
          <GenerationCard key={gen.id} generation={gen} onReuse={onReuse} onUseAsReference={onUseAsReference} />
        ))}
      </div>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
