"use client";

import { useRef, useState, type FormEvent } from "react";
import { Images, Link2, Upload, X } from "lucide-react";
import type { MediaSlot, PublicModel } from "@reflow/core";
import { errorMessage, type CreateType, type MediaAsset } from "@/lib/client/api";
import { acceptFor, importUrl, uploadFile } from "@/lib/client/media";
import { humanize, shortId } from "@/lib/client/format";
import { useDraft, useStudioStore } from "@/lib/client/store";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaThumb } from "@/components/ui/media-thumb";
import { AssetPickerModal } from "@/components/create/asset-picker-modal";

export function MediaSlots({ type, model }: { type: CreateType; model: PublicModel }) {
  const draft = useDraft(type);
  return (
    <div className="flex flex-col gap-3">
      {model.medias.map((slot) => (
        <MediaSlotField key={`${model.id}:${slot.role}`} type={type} slot={slot} values={draft.medias[slot.role] ?? []} />
      ))}
    </div>
  );
}

function MediaSlotField({ type, slot, values }: { type: CreateType; slot: MediaSlot; values: string[] }) {
  const max = slot.max ?? 1;
  const previews = useStudioStore((s) => s.previews);
  const addMedia = useStudioStore((s) => s.addMedia);
  const removeMedia = useStudioStore((s) => s.removeMedia);
  const setPreview = useStudioStore((s) => s.setPreview);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const remaining = max - values.length;

  function add(id: string, previewUrl: string | null, label?: string) {
    setPreview(id, { url: previewUrl, kind: slot.kind, label });
    if (!addMedia(type, slot.role, id, max)) setError(`This slot holds at most ${max} item${max > 1 ? "s" : ""}.`);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files).slice(0, Math.max(1, remaining))) {
      setBusy(`Uploading ${file.name}…`);
      try {
        const result = await uploadFile(file);
        add(result.asset_id, result.url, file.name);
      } catch (err) {
        setError(errorMessage(err));
      }
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy("Importing URL…");
    try {
      const result = await importUrl(url, slot.kind === "image" || slot.kind === "video" || slot.kind === "audio" ? slot.kind : undefined);
      add(result.asset_id, result.url, url);
      setUrl("");
      setUrlOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function handlePick(asset: MediaAsset) {
    setError(null);
    add(asset.id, asset.url);
    setPickerOpen(false);
  }

  return (
    <Field
      label={
        <>
          {humanize(slot.role)}
          {slot.required ? <span className="text-danger"> *</span> : null}
        </>
      }
      hint={slot.description}
      error={error}
      trailing={
        <span className="font-mono text-[11px] text-subtle">
          {values.length}/{max}
        </span>
      }
    >
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${humanize(slot.role)} items`}>
          {values.map((value) => {
            const preview = previews[value];
            return (
              <li key={value} className="relative">
                <MediaThumb url={preview?.url} kind={slot.kind} alt={preview?.label ?? value} className="size-16 rounded-md border border-border" />
                <span className="sr-only">{preview?.label ?? shortId(value)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${preview?.label ?? shortId(value)}`}
                  onClick={() => removeMedia(type, slot.role, value)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-panel text-muted shadow hover:text-danger"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {remaining > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Images className="size-3.5" aria-hidden /> Assets
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} loading={busy !== null}>
            <Upload className="size-3.5" aria-hidden /> Upload
          </Button>
          <Button size="sm" onClick={() => setUrlOpen((o) => !o)} aria-expanded={urlOpen} aria-controls={`url-form-${slot.role}`}>
            <Link2 className="size-3.5" aria-hidden /> URL
          </Button>
          <input ref={fileRef} type="file" accept={acceptFor(slot.kind)} multiple={remaining > 1} className="sr-only" tabIndex={-1} aria-label={`Upload ${slot.kind}`} onChange={(e) => void handleFiles(e.target.files)} />
        </div>
      ) : null}
      {urlOpen && remaining > 0 ? (
        <form id={`url-form-${slot.role}`} onSubmit={(e) => void handleImport(e)} className="flex gap-1.5">
          <Input type="url" inputMode="url" required placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={`${humanize(slot.role)} URL`} pattern="https://.*" />
          <Button type="submit" loading={busy?.startsWith("Importing") ?? false}>
            Import
          </Button>
        </form>
      ) : null}
      {busy ? (
        <p className="text-xs text-muted" role="status">
          {busy}
        </p>
      ) : null}
      <AssetPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} kind={slot.kind} onPick={handlePick} />
    </Field>
  );
}
