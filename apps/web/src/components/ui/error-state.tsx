import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Server error digest; shown so the owner can find the matching entry in the logs. */
  digest?: string;
  onRetry?: () => void;
  /** Links or buttons next to "Try again" (back to studio, setup checklist). */
  actions?: ReactNode;
  className?: string;
}

/**
 * Full-area error message for route error boundaries (error.tsx,
 * global-error.tsx). Server errors arrive redacted in production, so the copy
 * explains where to look instead of echoing the message.
 */
export function ErrorState({ title = "Something went wrong", description, digest, onRetry, actions, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("mx-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-16 text-center", className)}>
      <span className="flex size-12 items-center justify-center rounded-md border border-danger/30 bg-danger/10 text-danger" aria-hidden>
        <TriangleAlert className="size-5" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {description ? <div className="text-sm text-muted">{description}</div> : null}
        {digest ? (
          <p className="text-xs text-subtle">
            Reference <code className="rounded-xs bg-elevated px-1.5 py-0.5 text-fg-2 select-all">{digest}</code>
          </p>
        ) : null}
      </div>
      {onRetry || actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
