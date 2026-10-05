import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small line above the title (a section name or a back link). */
  eyebrow?: ReactNode;
  className?: string;
}

/** Page title row: 20 px semibold title, muted description, actions on the right (wrapping below on phones). */
export function PageHeader({ title, description, actions, eyebrow, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6 sm:py-5", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-muted">{eyebrow}</div> : null}
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
