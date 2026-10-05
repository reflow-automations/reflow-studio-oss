"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: ReactNode;
  /** `dialog` (centred, default) or `sheet` (pinned to the bottom edge, for mobile menus). */
  variant?: "dialog" | "sheet";
  /** Extra classes for the scrolling body. */
  bodyClassName?: string;
  className?: string;
}

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };

/**
 * Accessible modal built on the native <dialog> element (focus trap, Esc and
 * the top layer for free). Title and description ids come from useId, so any
 * number of modals can be mounted at once.
 */
export function Modal({ open, onClose, title, description, children, size = "lg", footer, variant = "dialog", bodyClassName, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const sheet = variant === "sheet";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        "border border-border bg-panel p-0 text-fg shadow-overlay open:flex open:flex-col",
        sheet
          ? "mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-lg rounded-b-none border-b-0 pb-[env(safe-area-inset-bottom)]"
          : cn("m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] rounded-lg", sizes[size]),
        className,
      )}
    >
      {sheet ? <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden /> : null}
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-[13px] text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <Button icon size="sm" variant="ghost" aria-label="Close" onClick={onClose} className="-mt-1 -mr-2">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>{children}</div>
      {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
    </dialog>
  );
}
