"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** `sm` (28 px) for dense rows, `md` (32 px, default) elsewhere. */
  size?: "sm" | "md";
}

const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-8 px-3 text-[13px]" };

/** Toggle chip (aria-pressed) used for aspect ratios, durations and counts. */
export function Chip({ active = false, size = "md", className, type = "button", ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size],
        active ? "border-accent bg-accent-soft text-fg" : "border-border-strong bg-elevated text-muted hover:border-control hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
