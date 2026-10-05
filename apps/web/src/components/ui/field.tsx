import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface FieldProps {
  label: ReactNode;
  /** Id of the single control this label belongs to. Without it the field is a labelled group (chip rows, sliders with a number box). */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Id of the hint/error line for `htmlFor`, so a control can point aria-describedby at it. */
export function fieldMessageId(htmlFor: string): string {
  return `${htmlFor}-message`;
}

/**
 * Label + control + hint/error. With `htmlFor` it renders a real <label>;
 * without it the wrapper becomes role="group" named by the label, so chip rows
 * and other multi-control fields are announced with their label instead of
 * leaving an orphan <label> behind.
 */
export function Field({ label, htmlFor, hint, error, trailing, className, children }: FieldProps) {
  const generatedId = useId();
  const labelId = `${htmlFor ?? generatedId}-label`;
  const messageId = htmlFor ? fieldMessageId(htmlFor) : `${generatedId}-message`;
  const labelClass = "text-xs font-medium text-fg-2";
  return (
    <div className={cn("flex flex-col gap-1.5", className)} role={htmlFor ? undefined : "group"} aria-labelledby={htmlFor ? undefined : labelId}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        {htmlFor ? (
          <label id={labelId} htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <span id={labelId} className={labelClass}>
            {label}
          </span>
        )}
        {trailing}
      </div>
      {children}
      {error ? (
        <p id={messageId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
