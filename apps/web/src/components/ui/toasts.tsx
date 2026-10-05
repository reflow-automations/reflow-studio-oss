"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useStudioStore, type Notice } from "@/lib/client/store";
import { cn } from "@/lib/utils/cn";

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  const Icon = notice.tone === "error" ? CircleAlert : notice.tone === "success" ? CircleCheck : Info;
  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-md border bg-elevated py-2.5 pr-2 pl-3 text-sm shadow-overlay",
        notice.tone === "error" ? "border-danger/45" : notice.tone === "success" ? "border-success/45" : "border-border-strong",
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", notice.tone === "error" ? "text-danger" : notice.tone === "success" ? "text-success" : "text-info")} aria-hidden />
      <p className="min-w-0 flex-1 text-fg">{notice.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={() => onDismiss(notice.id)} className="-my-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-fg">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Toast stack. Both live regions are always mounted (screen readers often
 * miss a region that appears together with its first message): errors go to
 * an assertive role="alert" region, everything else to a polite status region.
 * Sits above the mobile tab bar below lg.
 */
export function Toasts() {
  const notices = useStudioStore((s) => s.notices);
  const dismiss = useStudioStore((s) => s.dismissNotice);
  const errors = notices.filter((n) => n.tone === "error");
  const others = notices.filter((n) => n.tone !== "error");
  return (
    <div className="pointer-events-none fixed right-4 bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom)+0.75rem)] z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4">
      <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {errors.map((n) => (
          <Toast key={n.id} notice={n} onDismiss={dismiss} />
        ))}
      </div>
      <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {others.map((n) => (
          <Toast key={n.id} notice={n} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}
