"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { createOwnerAction, type SetupActionState } from "@/app/setup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, fieldMessageId } from "@/components/ui/field";
import { ErrorBanner } from "@/components/ui/banner";

function errorTitle(state: SetupActionState): string {
  switch (state.code) {
    case "rate_limited":
      return "Too many attempts";
    case "invalid_secret":
      return "Wrong deploy secret";
    case "not_configured":
      return "Setup is not finished";
    case "not_allowed":
      return "E-mail not allowed";
    case "owner_exists":
      return "Owner already exists";
    default:
      return "Could not create the owner account";
  }
}

/** First-owner form: e-mail, password and the deploy secret (REFLOW_SECRET). */
export function OwnerForm({ suggestedEmail }: { suggestedEmail?: string }) {
  const [state, action, pending] = useActionState<SetupActionState, FormData>(createOwnerAction, {});
  const [showPassword, setShowPassword] = useState(false);
  const retryMinutes = state.retryAfterSeconds ? Math.ceil(state.retryAfterSeconds / 60) : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error ? (
        <ErrorBanner
          title={errorTitle(state)}
          message={retryMinutes && state.code === "rate_limited" ? `Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.` : state.error}
        />
      ) : null}
      <Field label="E-mail" htmlFor="setup-email" hint="Must be listed in OWNER_EMAILS.">
        <Input
          id="setup-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email ?? suggestedEmail ?? ""}
          placeholder="you@example.com"
          aria-describedby={fieldMessageId("setup-email")}
          className="h-11 sm:h-10"
        />
      </Field>
      <Field label="Password" htmlFor="setup-password" hint="8 to 72 characters.">
        <div className="relative">
          <Input
            id="setup-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            aria-describedby={fieldMessageId("setup-password")}
            className="h-11 pr-11 sm:h-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-xs text-muted transition-colors hover:bg-hover hover:text-fg sm:size-8"
          >
            {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <Field label="Deploy secret" htmlFor="setup-secret" hint="The value of REFLOW_SECRET in your environment. It proves you own this deployment.">
        <Input id="setup-secret" name="setupSecret" type="password" autoComplete="off" required spellCheck={false} aria-describedby={fieldMessageId("setup-secret")} className="h-11 font-mono sm:h-10" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        Create owner account
      </Button>
    </form>
  );
}
