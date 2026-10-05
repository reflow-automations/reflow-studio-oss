import type { CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";

/** Shimmering placeholder block (static under prefers-reduced-motion). Decorative: wrap a group in a labelled status if it needs announcing. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton rounded-sm", className)} style={style} aria-hidden />;
}
