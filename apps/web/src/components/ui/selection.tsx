"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckSquare, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export interface Selection {
  active: boolean;
  selected: ReadonlySet<string>;
  setActive: (active: boolean) => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  /** Leave select mode and drop the selection. */
  exit: () => void;
}

/**
 * Multi-select state for a grid of cards. Escape leaves select mode, unless a
 * dialog (confirm modal, media viewer) is open: that dialog handles Escape itself.
 */
export function useSelection(): Selection {
  const [active, setActiveState] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const exit = useCallback(() => {
    setActiveState(false);
    setSelected(new Set());
  }, []);
  const setActive = useCallback((next: boolean) => (next ? setActiveState(true) : exit()), [exit]);
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, exit]);

  return useMemo(() => ({ active, selected, setActive, toggle, selectAll, clear, exit }), [active, selected, setActive, toggle, selectAll, clear, exit]);
}

/** Toolbar button that switches select mode on and off. */
export function SelectToggle({ selection, disabled }: { selection: Selection; disabled?: boolean }) {
  return (
    <Button variant={selection.active ? "primary" : "secondary"} aria-pressed={selection.active} onClick={() => selection.setActive(!selection.active)} disabled={disabled && !selection.active}>
      <CheckSquare className="size-3.5" aria-hidden /> {selection.active ? "Done" : "Select"}
    </Button>
  );
}

/**
 * Card overlay in select mode: the whole card is the label of a real checkbox,
 * so a click anywhere toggles it. The visible box sits top-left in a 44 px target.
 */
export function SelectOverlay({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <label className={cn("absolute inset-0 z-10 cursor-pointer rounded-lg transition-colors", checked ? "bg-accent/10 ring-2 ring-accent ring-inset" : "hover:bg-fg/5")}>
      <span className="absolute top-0 left-0 flex size-11 items-center justify-center">
        <span className="flex size-6 items-center justify-center rounded-sm bg-bg/80 shadow-sm backdrop-blur">
          <input type="checkbox" checked={checked} onChange={onToggle} className="size-4 cursor-pointer accent-accent" />
        </span>
      </span>
      <span className="sr-only">{label}</span>
    </label>
  );
}

interface SelectionBarProps {
  selection: Selection;
  /** Ids of the loaded items, for "Select all" and the visible count. */
  ids: string[];
  onDelete: (ids: string[]) => void;
  deleting?: boolean;
}

/** Sticky action bar shown in select mode: count, select all, cancel and delete. */
export function SelectionBar({ selection, ids, onDelete, deleting }: SelectionBarProps) {
  if (!selection.active) return null;
  const chosen = ids.filter((id) => selection.selected.has(id));
  const allSelected = ids.length > 0 && chosen.length === ids.length;
  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="sticky bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+0.5rem)] z-20 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-lg border border-border-strong bg-panel px-3 py-2 shadow-overlay lg:bottom-4"
    >
      <span className="text-sm font-medium text-fg tabular-nums" aria-live="polite">
        {chosen.length} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => (allSelected ? selection.clear() : selection.selectAll(ids))} disabled={ids.length === 0}>
          {allSelected ? "Select none" : "Select all"}
        </Button>
        <Button size="sm" variant="outline" onClick={selection.exit}>
          <X className="size-3.5" aria-hidden /> Cancel
        </Button>
        <Button size="sm" variant="danger" onClick={() => onDelete(chosen)} disabled={chosen.length === 0} loading={deleting}>
          <Trash2 className="size-3.5" aria-hidden /> Delete
        </Button>
      </div>
    </div>
  );
}

interface ConfirmDeleteModalProps {
  /** Ids waiting for confirmation; null keeps the modal closed. */
  ids: string[] | null;
  onCancel: () => void;
  onConfirm: (ids: string[]) => void;
  pending?: boolean;
  /** Extra line under the standard warning. */
  note?: ReactNode;
}

/** "Delete N items?" confirmation in the shared Modal. */
export function ConfirmDeleteModal({ ids, onCancel, onConfirm, pending, note }: ConfirmDeleteModalProps) {
  const count = ids?.length ?? 0;
  return (
    <Modal
      open={ids !== null}
      onClose={() => {
        if (!pending) onCancel();
      }}
      size="sm"
      title={`Delete ${count} ${count === 1 ? "item" : "items"}?`}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => ids && onConfirm(ids)} loading={pending} autoFocus>
            <Trash2 className="size-3.5" aria-hidden /> Delete
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg">This removes the files from your storage. Costs stay in your usage history. This cannot be undone.</p>
      {note ? <p className="mt-2 text-[13px] text-muted">{note}</p> : null}
    </Modal>
  );
}
