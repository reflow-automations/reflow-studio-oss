import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Shared control styling. Borders use the control token (3:1 against every
 * surface). Text is 16 px below sm so iOS Safari does not zoom on focus, and
 * 13 px from sm up. Focus shows an accent border plus a soft ring instead of
 * the global outline, so the field keeps its own corner radius. To change the
 * text size, pass both a base and an sm: size (for example "text-xs sm:text-xs").
 */
export const controlClasses =
  "w-full rounded-sm border border-control bg-bg text-fg placeholder:text-subtle transition-[border-color,box-shadow] duration-150 hover:border-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-soft)] focus:outline-none aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-control";

const controlText = "text-base sm:text-[13px]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlClasses, controlText, "h-9 px-3", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(controlClasses, controlText, "min-h-20 resize-y px-3 py-2 leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <div className={cn("relative", className)}>
      <select ref={ref} className={cn(controlClasses, controlText, "h-9 appearance-none pr-9 pl-3")} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
});
