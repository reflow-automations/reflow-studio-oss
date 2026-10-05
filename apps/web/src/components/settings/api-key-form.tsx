"use client";

import { useActionState, useId } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { createApiKeyAction, type CreateApiKeyState } from "@/app/actions/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/copy-button";
import { ErrorBanner } from "@/components/ui/banner";
import { McpSnippets } from "@/components/settings/mcp-snippets";

export function ApiKeyForm({ origin }: { origin: string }) {
  const [state, action, pending] = useActionState<CreateApiKeyState, FormData>(createApiKeyAction, {});
  const id = useId();

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Key name" htmlFor={`${id}-name`}>
            <Input id={`${id}-name`} name="name" required maxLength={80} placeholder="e.g. claude-code laptop" autoComplete="off" />
          </Field>
          <Field label="Expires in (days)" htmlFor={`${id}-exp`} hint="0 = never">
            <Input id={`${id}-exp`} name="expires_in_days" type="number" min={0} max={3650} defaultValue={0} className="w-28" />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[11px] font-medium tracking-wide text-muted uppercase">Scopes</legend>
            <div className="flex h-8 items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" name="scopes" value="read" defaultChecked className="accent-(--color-accent)" /> read
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" name="scopes" value="generate" defaultChecked className="accent-(--color-accent)" /> generate
              </label>
            </div>
          </fieldset>
        </div>
        {state.error ? <ErrorBanner title="Could not create key" message={state.error} /> : null}
        <div>
          <Button type="submit" variant="primary" loading={pending}>
            <KeyRound className="size-3.5" aria-hidden /> Create API key
          </Button>
        </div>
      </form>

      {state.secret && state.key ? (
        <section aria-live="polite" className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success/5 p-4">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-xs text-muted">
              This is the only time the secret for <span className="font-medium text-fg">{state.key.name}</span> is shown. Copy it now and store it safely.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs">{state.secret}</code>
            <CopyButton value={state.secret} label="Copy key" variant="primary" />
          </div>
          <McpSnippets origin={origin} apiKey={state.secret} />
        </section>
      ) : null}
    </div>
  );
}
