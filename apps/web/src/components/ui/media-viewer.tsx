"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Play, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface MediaViewerItem {
  url: string;
  kind: string;
  alt?: string;
}

interface MediaViewerProps {
  open: boolean;
  onClose: () => void;
  items: MediaViewerItem[];
  startIndex?: number;
  /** Optional caption under the media, e.g. the prompt. */
  caption?: string;
  /** Optional link to the full details page. */
  detailsHref?: string;
  /** Optional delete action (the caller confirms); shows a trash button in the top bar. */
  onDelete?: () => void;
  /** Accessible name of the delete button. */
  deleteLabel?: string;
}

/**
 * Full-screen lightbox for images and videos, built on the native <dialog>
 * (focus trap and Esc for free). Arrow keys step through multiple outputs;
 * clicking the dark backdrop closes it. Videos start playing with controls.
 */
export function MediaViewer({ open, onClose, items, startIndex = 0, caption, detailsHref, onDelete, deleteLabel }: MediaViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={items[startIndex]?.alt || "Media viewer"}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/90 p-0 text-white backdrop:bg-black/80 open:flex open:flex-col"
    >
      {open && items.length ? <ViewerBody key={startIndex} items={items} startIndex={startIndex} caption={caption} detailsHref={detailsHref} onClose={onClose} onDelete={onDelete} deleteLabel={deleteLabel} /> : null}
    </dialog>
  );
}

const control = "inline-flex size-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-accent";

function ViewerBody({ items, startIndex, caption, detailsHref, onClose, onDelete, deleteLabel = "Delete" }: Omit<MediaViewerProps, "open"> & { startIndex: number }) {
  const [index, setIndex] = useState(startIndex);
  const count = items.length;
  const current = items[Math.min(index, count - 1)];
  const step = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);

  useEffect(() => {
    if (count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, step]);

  if (!current) return null;

  return (
    <>
      <div className="flex items-center gap-2 p-3">
        {count > 1 ? (
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs tabular-nums">
            {index + 1} / {count}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {detailsHref ? (
            <Link href={detailsHref as Route} className={control} aria-label="Open details" title="Open details" onClick={onClose}>
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          ) : null}
          <a href={current.url} target="_blank" rel="noreferrer" download className={control} aria-label="Download" title="Download">
            <Download className="size-4" aria-hidden />
          </a>
          {onDelete ? (
            <button type="button" onClick={onDelete} className={cn(control, "hover:bg-danger/80")} aria-label={deleteLabel} title={deleteLabel}>
              <Trash2 className="size-4" aria-hidden />
            </button>
          ) : null}
          <button type="button" onClick={onClose} className={control} aria-label="Close" title="Close (Esc)">
            <X className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-16"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {current.kind === "video" ? (
          <video key={current.url} src={current.url} controls autoPlay playsInline className="max-h-full max-w-full rounded-md bg-black object-contain" aria-label={current.alt || "video"} />
        ) : current.kind === "audio" ? (
          <audio key={current.url} src={current.url} controls autoPlay className="w-full max-w-xl" aria-label={current.alt || "audio"} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed or provider URLs, not optimizable
          <img key={current.url} src={current.url} alt={current.alt ?? ""} className="max-h-full max-w-full rounded-md object-contain" />
        )}

        {count > 1 ? (
          <>
            <button type="button" onClick={() => step(-1)} className={cn(control, "absolute top-1/2 left-3 -translate-y-1/2")} aria-label="Previous">
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button type="button" onClick={() => step(1)} className={cn(control, "absolute top-1/2 right-3 -translate-y-1/2")} aria-label="Next">
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        ) : null}
      </div>

      {caption ? <p className="mx-auto line-clamp-3 max-w-3xl px-4 pt-2 pb-4 text-center text-sm text-white/80">{caption}</p> : <div className="h-4" />}
    </>
  );
}

/** Round play button drawn over video thumbnails. Purely decorative: the parent is the click target. */
export function PlayOverlay({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute inset-0 flex items-center justify-center", className)} aria-hidden>
      <span className="flex size-12 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur transition-transform group-hover:scale-110">
        <Play className="ml-0.5 size-5 fill-current" />
      </span>
    </span>
  );
}
