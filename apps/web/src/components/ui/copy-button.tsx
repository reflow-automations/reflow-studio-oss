"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface CopyButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  value: string;
  label?: string;
  /** Text shown (and announced) after a successful copy. */
  copiedLabel?: string;
  /** Icon-only button: `label` becomes the accessible name. */
  iconOnly?: boolean;
}

const RESET_MS = 1500;

/**
 * Copies `value` to the clipboard. The result is announced through a visually
 * hidden polite live region, so the button's own name stays stable for
 * screen readers.
 */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", iconOnly = false, size = "sm", variant = "outline", ...props }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), RESET_MS);
    } catch {
      setStatus("failed");
    }
  }

  const text = status === "copied" ? copiedLabel : status === "failed" ? "Copy failed" : label;
  const icon = status === "copied" ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />;

  return (
    <>
      <Button size={size} variant={variant} icon={iconOnly} onClick={copy} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} {...props}>
        {icon}
        {iconOnly ? null : text}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {status === "idle" ? "" : status === "copied" ? copiedLabel : "Copy failed"}
      </span>
    </>
  );
}
