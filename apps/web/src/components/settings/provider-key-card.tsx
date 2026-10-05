"use client";

import { useActionState, useId, useState } from "react";
import { ExternalLink, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { removeProviderKeyAction, saveProviderKeyAction, testProviderKeyAction, type ProviderKeyState } from "@/app/actions/providers";
import type { ProviderKeyView } from "@/lib/settings/provider-keys";
import { formatDate } from "@/lib/client/format";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, InfoBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function StatusBadge({ item }: { item: ProviderKeyView }) {
  if (item.source === "none") return <Badge tone="outline">not configured</Badge>;
  if (item.status === "valid") return <Badge tone="success">valid</Badge>;
  if (item.status === "invalid") return <Badge tone="danger">invalid</Badge>;
  return <Badge tone="warning">untested</Badge>;
}

export function ProviderKeyCard({ item, encryptionReady }: { item: ProviderKeyView; encryptionReady: boolean }) {
  const id = useId();
  const [saveState, saveAction, saving] = useActionState<ProviderKeyState, FormData>(saveProviderKeyAction, {});
  const [testState, testAction, testing] = useActionState<ProviderKeyState, FormData>(testProviderKeyAction, {});
  const [removeState, removeAction, removing] = useActionState<ProviderKeyState, FormData>(removeProviderKeyAction, {});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const feedback = [saveState, testState, removeState].filter((s) => s.message || s.error);
  const latest = feedback[feedback.length - 1];

  return (
    <section aria-label={`${item.label} API key`} className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-accent" aria-hidden />
          <h2 className="text-sm font-semibold">{item.label}</h2>
          <StatusBadge item={item} />
          {item.source === "env" ? <Badge tone="info">from environment</Badge> : null}
          {item.source === "app" ? <Badge tone="accent">saved in app</Badge> : null}
        </div>
        <a href={item.help_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          Get a key <ExternalLink className="size-3" aria-hidden />
        </a>
      </div>
      <p className="text-xs text-muted">{item.help}</p>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">Key</dt>
        <dd className="font-mono">{item.key_hint ?? "—"}</dd>
        <dt className="text-muted">Last tested</dt>
        <dd className="text-muted">{item.last_tested_at ? formatDate(item.last_tested_at) : "never"}</dd>
        {item.last_error ? (
          <>
            <dt className="text-muted">Last error</dt>
            <dd className="text-danger">{item.last_error}</dd>
          </>
        ) : null}
      </dl>

      {!encryptionReady ? <ErrorBanner title="Encryption not configured" message="Set REFLOW_SECRET (or KEY_ENCRYPTION_SECRET) and redeploy before saving keys here. Environment variables still work." /> : null}

      <form action={saveAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="provider" value={item.provider} />
        <Field label={item.provider === "higgsfield" ? "API key ID:secret" : item.source === "app" ? "Replace key" : "API key"} htmlFor={`${id}-secret`} className="flex-1">
          <Input id={`${id}-secret`} name="secret" type="password" autoComplete="off" placeholder={item.provider === "higgsfield" ? "Paste KEY_ID:KEY_SECRET" : "Paste the key; it is encrypted before it is stored"} required minLength={8} disabled={!encryptionReady} />
        </Field>
        <Button type="submit" variant="primary" loading={saving} disabled={!encryptionReady}>
          Save &amp; test
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {item.source !== "none" ? (
          <form action={testAction}>
            <input type="hidden" name="provider" value={item.provider} />
            <Button type="submit" size="sm" variant="outline" loading={testing}>
              <RefreshCw className="size-3.5" aria-hidden /> Test
            </Button>
          </form>
        ) : null}
        {item.source === "app" ? (
          confirmRemove ? (
            <form action={removeAction} className="flex items-center gap-1.5">
              <input type="hidden" name="provider" value={item.provider} />
              <Button type="submit" size="sm" variant="danger" loading={removing}>
                Confirm remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Keep
              </Button>
            </form>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-3.5" aria-hidden /> Remove
            </Button>
          )
        ) : null}
      </div>

      {latest?.error ? <ErrorBanner title={latest.message ?? "Something went wrong"} message={latest.error} /> : latest?.message ? <InfoBanner>{latest.message}</InfoBanner> : null}
    </section>
  );
}
