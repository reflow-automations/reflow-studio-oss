"use client";

import { cn } from "@/lib/utils/cn";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name when there is no visible label; otherwise use `labelledBy`. */
  label?: string;
  /** Id of a visible element that names the switch. */
  labelledBy?: string;
  /** Id of an element that describes the switch (a hint line). */
  describedBy?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Switch (role="switch"). The off-state track uses the control border (3:1)
 * so it is visible on every surface; the on-state thumb is ink on orange.
 */
export function Toggle({ checked, onChange, label, labelledBy, describedBy, id, disabled, className }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-control bg-elevated hover:border-muted",
        className,
      )}
    >
      <span className={cn("absolute size-4 rounded-full shadow-sm transition-transform duration-150", checked ? "translate-x-[19px] bg-accent-fg" : "translate-x-[3px] bg-muted")} aria-hidden />
    </button>
  );
}
