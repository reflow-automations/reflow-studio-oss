import { forwardRef, type ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Square icon-only button; pass `aria-label`. */
  icon?: boolean;
}

const base =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Ink on orange: 8.9:1. The inset highlight gives the one primary action a little lift.
  primary: "bg-accent font-semibold text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.28)] hover:bg-accent-strong active:bg-accent-strong disabled:hover:bg-accent",
  secondary: "border border-border-strong bg-elevated text-fg hover:border-control hover:bg-hover disabled:hover:border-border-strong disabled:hover:bg-elevated",
  outline: "border border-border-strong bg-transparent text-fg hover:border-control hover:bg-hover disabled:hover:border-border-strong disabled:hover:bg-transparent",
  ghost: "bg-transparent text-muted hover:bg-hover hover:text-fg disabled:hover:bg-transparent disabled:hover:text-muted",
  danger: "border border-danger/35 bg-danger/10 text-danger hover:border-danger/60 hover:bg-danger/20",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-7 gap-1 rounded-sm px-2 text-xs",
  sm: "h-8 gap-1.5 rounded-sm px-2.5 text-xs",
  md: "h-9 gap-2 rounded-sm px-3.5 text-[13px]",
  lg: "h-11 gap-2 rounded-md px-5 text-sm",
};

const iconSizes: Record<ButtonSize, string> = { xs: "w-7 px-0", sm: "w-8 px-0", md: "w-9 px-0", lg: "w-11 px-0" };

const spinnerSizes: Record<ButtonSize, string> = { xs: "size-3.5", sm: "size-3.5", md: "size-4", lg: "size-4" };

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  className?: string;
}

/**
 * Button styles as a class string, for links and other elements that should
 * look like a button (`<Link className={buttonClasses({ variant: "primary" })}>`).
 */
export function buttonClasses({ variant = "secondary", size = "md", icon = false, className }: ButtonClassOptions = {}): string {
  return cn(base, variants[variant], sizes[size], icon && iconSizes[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "secondary", size = "md", loading = false, icon = false, disabled, children, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // A busy button stays legible (it is disabled only to block double submits).
      className={buttonClasses({ variant, size, icon, className: cn(loading && !disabled && "disabled:cursor-wait disabled:opacity-80", className) })}
      {...props}
    >
      {loading ? <LoaderCircle className={cn("animate-spin", spinnerSizes[size])} aria-hidden /> : null}
      {/* An icon button keeps its width while loading: the spinner replaces the icon. */}
      {loading && icon ? null : children}
    </button>
  );
});
