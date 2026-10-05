import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "outline";
export type BadgeSize = "sm" | "md";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border-strong bg-elevated text-fg-2",
  outline: "border-border-strong bg-transparent text-muted",
  accent: "border-accent/35 bg-accent-soft text-accent",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-muted",
  outline: "bg-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

// 11 px is the one exception to the 12 px minimum: badges are short, high-contrast labels.
const sizes: Record<BadgeSize, string> = { sm: "h-5 px-1.5 text-2xs", md: "h-6 px-2 text-xs" };

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Leading status dot in the tone colour. */
  dot?: boolean;
}

export function Badge({ tone = "neutral", size = "sm", dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-xs border font-medium whitespace-nowrap", sizes[size], tones[tone], className)} {...props}>
      {dot ? <span className={cn("size-1.5 shrink-0 rounded-full", dots[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}
