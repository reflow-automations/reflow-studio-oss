"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Images } from "lucide-react";
import type { MediaKind } from "@reflow/core";
import { api, errorMessage, type MediaAsset } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/format";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { MediaThumb } from "@/components/ui/media-thumb";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";

interface AssetPickerModalProps {
  open: boolean;
  onClose: () => void;
  kind: MediaKind;
  onPick: (asset: MediaAsset) => void;
}

export function useMediaList(kind: MediaKind | undefined, enabled = true, pageSize = 40) {
  return useInfiniteQuery({
    queryKey: ["media", { kind: kind ?? null, pageSize }],
    queryFn: ({ pageParam }) => api.media.list({ type: kind, limit: pageSize, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function assetLabel(asset: MediaAsset): string {
  const meta = asset.metadata as { filename?: string } | null;
  return meta?.filename ?? (asset.origin === "generated" ? "generated" : asset.origin) + " · " + formatRelative(asset.created_at);
}

export function AssetPickerModal({ open, onClose, kind, onPick }: AssetPickerModalProps) {
  const query = useMediaList(kind, open);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pick ${kind}`}
      description="Ready assets in your workspace, newest first."
      footer={
        <>
          {query.hasNextPage ? (
            <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              Load more
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {query.isPending ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5" aria-busy>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorBanner title="Could not load assets" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Images className="size-6" aria-hidden />} title={`No ${kind} assets yet`} description="Upload a file or import a URL from the slot controls or the Assets page." />
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {items.map((asset) => (
            <li key={asset.id}>
              <button type="button" onClick={() => onPick(asset)} className="block w-full overflow-hidden rounded-md border border-border bg-elevated text-left transition-colors hover:border-accent focus-visible:border-accent" title={asset.id}>
                <MediaThumb url={asset.url} kind={asset.kind} alt={assetLabel(asset)} className="aspect-square w-full" />
                <span className="block truncate px-1.5 py-1 text-[11px] text-muted">{assetLabel(asset)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
