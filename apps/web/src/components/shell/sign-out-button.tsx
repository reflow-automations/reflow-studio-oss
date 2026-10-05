"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

function SubmitButton({ iconOnly, size, variant, className }: { iconOnly: boolean; size: ButtonSize; variant: ButtonVariant; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant={variant} icon={iconOnly} loading={pending} aria-label={iconOnly ? "Sign out" : undefined} title="Sign out" className={className}>
      {/* While pending the button's spinner takes the icon's place. */}
      {pending ? null : <LogOut className="size-4" aria-hidden />}
      {iconOnly ? null : "Sign out"}
    </Button>
  );
}

interface SignOutButtonProps {
  iconOnly?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** Classes for the button (the form wrapper takes `formClassName`). */
  className?: string;
  formClassName?: string;
}

export function SignOutButton({ iconOnly = false, size = "sm", variant = "ghost", className, formClassName }: SignOutButtonProps) {
  return (
    <form action={signOut} className={cn(formClassName)}>
      <SubmitButton iconOnly={iconOnly} size={size} variant={variant} className={className} />
    </form>
  );
}
