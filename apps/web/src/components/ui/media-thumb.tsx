"use client";

import { useState } from "react";
import { Box, File, Film, Image as ImageIcon, ImageOff, Music } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type MediaFit = "cover" | "contain";

interface MediaThumbProps {
  url: string | null | undefined;
  kind: string;
  alt?: string;
  className?: string;
  /** Render video with controls (detail views) instead of a muted preview. */
  controls?: boolean;
  poster?: string | null;
  /** `cover` crops to fill the box (cards, default); `contain` shows the whole frame (detail views, lightboxes). */
  fit?: MediaFit;
  /** Intrinsic size, when known, so the browser reserves the right box before the file loads. */
  width?: number | null;
  height?: number | null;
  /** `lazy` (default) for grids; `eager` for the one hero image on a page. */
  loading?: "lazy" | "eager";
  /** Video preload hint. Defaults to "metadata"; use "none" in long grids. */
  preload?: "none" | "metadata" | "auto";
  /** Called once when the file fails to load (for example an expired signed URL), so the caller can refetch. */
  onExpired?: () => void;
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const cls = cn("size-5", className);
  switch (kind) {
    case "image":
      return <ImageIcon className={cls} aria-hidden />;
    case "video":
      return <Film className={cls} aria-hidden />;
    case "audio":
      return <Music className={cls} aria-hidden />;
    case "model":
      return <Box className={cls} aria-hidden />;
    default:
      return <File className={cls} aria-hidden />;
  }
}

const fitClass: Record<MediaFit, string> = { cover: "object-cover", contain: "object-contain" };

/**
 * Renders provider/signed media URLs. Deliberately uses <img>/<video> rather
 * than next/image: signed URLs are short-lived and hosts vary per provider.
 * A file that fails to load (expired URL, deleted object) falls back to a
 * labelled placeholder instead of the browser's broken-image icon.
 */
export function MediaThumb({ url, kind, alt = "", className, controls = false, poster, fit = "cover", width, height, loading = "lazy", preload = "metadata", onExpired }: MediaThumbProps) {
  // Keyed by URL so a fresh URL (after a refetch) gets a new attempt without an effect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = Boolean(url) && failedUrl === url;

  function handleError() {
    if (!url || failedUrl === url) return;
    setFailedUrl(url);
    onExpired?.();
  }

  if (!url || failed) {
    return (
      <div role="img" className={cn("flex items-center justify-center bg-elevated text-subtle", className)} aria-label={failed ? `${alt || kind} could not be loaded` : alt || kind}>
        {failed ? <ImageOff className="size-5" aria-hidden /> : <KindIcon kind={kind} />}
      </div>
    );
  }
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed/provider URLs must bypass the image optimizer
      <img src={url} alt={alt} loading={loading} decoding="async" width={width ?? undefined} height={height ?? undefined} onError={handleError} className={cn("bg-elevated", fitClass[fit], className)} />
    );
  }
  if (kind === "video") {
    return (
      <video
        src={url}
        controls={controls}
        preload={preload}
        playsInline
        muted={!controls}
        poster={poster ?? undefined}
        width={width ?? undefined}
        height={height ?? undefined}
        onError={handleError}
        className={cn("bg-black", fit === "cover" && !controls ? "object-cover" : "object-contain", className)}
        aria-label={alt || "video"}
      />
    );
  }
  if (kind === "audio") {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 bg-elevated p-3 text-subtle", className)}>
        <Music className="size-6" aria-hidden />
        <audio src={url} controls preload="metadata" onError={handleError} className="w-full max-w-full" aria-label={alt || "audio"} />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("flex items-center justify-center bg-elevated text-subtle hover:text-fg", className)} aria-label={alt ? `Open ${alt}` : `Open ${kind} file`}>
      <KindIcon kind={kind} />
    </a>
  );
}
