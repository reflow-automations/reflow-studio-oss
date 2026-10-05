"use client";

import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Images, Link2, Trash2, Upload } from "lucide-react";
import type { MediaKind } from "@reflow/core";
import { errorMessage, type MediaAsset } from "@/lib/client/api";
import { importUrl, uploadFile } from "@/lib/client/media";
import { formatBytes, formatDuration, formatRelative } from "@/lib/client/format";
import { useStudioStore } from "@/lib/client/store";
import { useDeleteMedia } from "@/lib/client/delete";
import { cn } from "@/lib/utils/cn";
import { assetLabel, useMediaList } from "@/components/create/asset-picker-modal";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MediaThumb } from "@/components/ui/media-thumb";
import { MediaViewer, PlayOverlay } from "@/components/ui/media-viewer";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState, ErrorBanner } from "@/components/ui/banner";
import { ConfirmDeleteModal, SelectionBar, SelectOverlay, SelectToggle, useSelection } from "@/components/ui/selection";

const KINDS: Array<{ value: MediaKind | ""; label: string }> = [
  { value: "", label: "All kinds" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "model", label: "3D models" },
  { value: "file", label: "Files" },
];

interface UploadRow {
  id: number;
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
}

export function AssetUploader({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let seq = Date.now();
    for (const file of Array.from(files)) {
      const id = seq++;
      setRows((r) => [...r.slice(-4), { id, name: file.name, status: "uploading" }]);
      try {
        await uploadFile(file);
        setRows((r) => r.map((row) => (row.id === id ? { ...row, status: "done" } : row)));
        onDone();
      } catch (err) {
        setRows((r) => r.map((row) => (row.id === id ? { ...row, status: "error", message: errorMessage(err) } : row)));
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={() => fileRef.current?.click()} loading={busy}>
        <Upload className="size-3.5" aria-hidden /> Upload files
      </Button>
      <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Upload files" onChange={(e) => void handleFiles(e.target.files)} />
      {rows.length > 0 ? (
        <ul className="text-[11px]" aria-live="polite">
          {rows.map((row) => (
            <li key={row.id} className={row.status === "error" ? "text-danger" : row.status === "done" ? "text-success" : "text-muted"}>
              {row.name}: {row.status === "error" ? row.message : row.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ImportUrlForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useStudioStore((s) => s.notify);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await importUrl(url);
      notify(`Imported ${result.kind} asset.`, "success");
      setUrl("");
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <Input type="url" inputMode="url" required pattern="https://.*" placeholder="https://example.com/image.png" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL to import" className="w-64" />
        <Button type="submit" loading={pending}>
          <Link2 className="size-3.5" aria-hidden /> Import
        </Button>
      </div>
      {error ? (
        <p className="text-[11px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

interface AssetCardProps {
  asset: MediaAsset;
  onDelete: (asset: MediaAsset) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

function AssetCard({ asset, onDelete, selectMode, selected, onToggleSelect }: AssetCardProps) {
  const [viewing, setViewing] = useState(false);
  return (
    <li className={cn("relative flex flex-col overflow-hidden rounded-lg border border-border bg-elevated", selected && "border-accent")}>
      {selectMode ? <SelectOverlay checked={selected} onToggle={() => onToggleSelect(asset.id)} label={`Select asset: ${assetLabel(asset)}`} /> : null}
      {asset.url ? (
        <button type="button" onClick={() => setViewing(true)} className="group relative aspect-square w-full cursor-zoom-in" aria-label={asset.kind === "video" ? "Play video" : "View full size"}>
          <MediaThumb url={asset.url} kind={asset.kind} alt={assetLabel(asset)} className="size-full" />
          {asset.kind === "video" ? <PlayOverlay /> : null}
        </button>
      ) : (
        <MediaThumb url={asset.url} kind={asset.kind} alt={assetLabel(asset)} className="aspect-square w-full" />
      )}
      {asset.url ? (
        <MediaViewer
          open={viewing}
          onClose={() => setViewing(false)}
          items={[{ url: asset.url, kind: asset.kind, alt: assetLabel(asset) }]}
          caption={assetLabel(asset)}
          onDelete={() => {
            setViewing(false);
            onDelete(asset);
          }}
          deleteLabel="Delete asset"
        />
      ) : null}
      <div className="flex flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <Badge>{asset.kind}</Badge>
          <span className="text-[11px] text-muted">{formatRelative(asset.created_at)}</span>
        </div>
        <p className="truncate text-xs text-fg" title={assetLabel(asset)}>
          {assetLabel(asset)}
        </p>
        <p className="font-mono text-[11px] text-subtle">
          {asset.origin} · {formatBytes(asset.bytes)}
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
          {asset.duration_seconds ? ` · ${formatDuration(asset.duration_seconds)}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <CopyButton value={asset.id} label="Copy id" size="xs" variant="ghost" />
          {asset.url ? (
            <a href={asset.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex size-7 items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-fg" aria-label="Open asset" title="Open">
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <Button icon size="xs" variant="ghost" title="Delete" aria-label="Delete asset" onClick={() => onDelete(asset)} className={cn("hover:text-danger", !asset.url && "ml-auto")}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function AssetsScreen() {
  const [kind, setKind] = useState<MediaKind | "">("");
  const queryClient = useQueryClient();
  const query = useMediaList(kind || undefined, true, 48);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["media"] });
  const selection = useSelection();
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const remove = useDeleteMedia({
    onDeleted: (result) => {
      setConfirming(null);
      if (result.deleted.length > 0) selection.exit();
    },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Assets"
        description="Uploads, imports and generated media available as references."
        actions={
          <>
            <Select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as MediaKind | "")} className="w-36">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            <ImportUrlForm onDone={refresh} />
            <AssetUploader onDone={refresh} />
            <SelectToggle selection={selection} disabled={items.length === 0} />
          </>
        }
      />
      <div className="p-4 sm:p-6">
        {query.isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6" aria-busy>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] w-full" />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorBanner title="Could not load assets" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Images className="size-6" aria-hidden />} title="No assets yet" description="Upload a file or import an https URL to use it as a reference." />
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {items.map((asset) => (
                <AssetCard key={asset.id} asset={asset} onDelete={(a) => setConfirming([a.id])} selectMode={selection.active} selected={selection.selected.has(asset.id)} onToggleSelect={selection.toggle} />
              ))}
            </ul>
            {query.hasNextPage ? (
              <div className="flex justify-center">
                <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
                  Load more
                </Button>
              </div>
            ) : null}
            <SelectionBar selection={selection} ids={items.map((a) => a.id)} onDelete={setConfirming} deleting={remove.isPending} />
          </div>
        )}
        <ConfirmDeleteModal
          ids={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={(ids) => remove.mutate(ids)}
          pending={remove.isPending}
          note="Generations that used these files keep their history; their previews fall back to the provider link, which may have expired."
        />
      </div>
    </div>
  );
}
