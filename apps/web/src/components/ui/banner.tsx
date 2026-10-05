import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

export type BannerTone = "info" | "success" | "warning" | "danger";

const tones: Record<BannerTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "border-info/30 bg-info/[0.07]", icon: "text-info", Icon: Info },
  success: { box: "border-success/30 bg-success/[0.07]", icon: "text-success", Icon: CircleCheck },
  warning: { box: "border-warning/30 bg-warning/[0.07]", icon: "text-warning", Icon: TriangleAlert },
  danger: { box: "border-danger/30 bg-danger/[0.08]", icon: "text-danger", Icon: CircleAlert },
};

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons or links on the right (stacked below on narrow screens). */
  action?: ReactNode;
  /** Override the tone icon. */
  icon?: ReactNode;
  className?: string;
  /** Defaults to "alert" for danger and none otherwise; pass "status" for polite updates. */
  role?: "alert" | "status";
}

/** Inline message block. ErrorBanner and InfoBanner are presets of this. */
export function Banner({ tone = "info", title, children, action, icon, className, role }: BannerProps) {
  const t = tones[tone];
  return (
    <div role={role ?? (tone === "danger" ? "alert" : undefined)} className={cn("flex flex-col gap-3 rounded-md border px-3.5 py-3 text-sm sm:flex-row sm:items-start", t.box, className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon ?? <t.Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} aria-hidden />}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-medium text-fg">{title}</p> : null}
          {children ? <div className={cn("break-words text-fg-2", title ? "mt-0.5" : undefined)}>{children}</div> : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2 pl-7 sm:pl-0">{action}</div> : null}
    </div>
  );
}

interface ErrorBannerProps {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ title = "Something went wrong", message, onRetry, className }: ErrorBannerProps) {
  return (
    <Banner
      tone="danger"
      title={title}
      className={className}
      action={
        onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    >
      {message}
    </Banner>
  );
}

export function InfoBanner({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <Banner tone="info" title={title} action={action} className={className}>
      {children}
    </Banner>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Empty list or first-run state: says what is missing and offers the next step. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-14 text-center", className)}>
      {icon ? <div className="flex size-11 items-center justify-center rounded-md border border-border bg-elevated text-muted">{icon}</div> : null}
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-fg">{title}</p>
        {description ? <p className="max-w-sm text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
