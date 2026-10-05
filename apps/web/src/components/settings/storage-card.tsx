"use client";

import { useActionState } from "react";
import { HardDrive } from "lucide-react";
import { applyStorageCorsAction, testStorageAction, type StorageActionState } from "@/app/actions/providers";
import type { StorageInfo } from "@/lib/storage";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, InfoBanner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

export function StorageCard({ info }: { info: StorageInfo }) {
  const [corsState, corsAction, corsPending] = useActionState<StorageActionState, FormData>(applyStorageCorsAction, {});
  const [testState, testAction, testPending] = useActionState<StorageActionState, FormData>(testStorageAction, {});
  const latest = [testState, corsState].filter((s) => s.message || s.error).pop();
  return (
    <section aria-label="Storage" className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4">
      <div className="flex items-center gap-2">
        <HardDrive className="size-4 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Storage</h2>
        {info.kind === "r2" ? <Badge tone="success">Cloudflare R2</Badge> : <Badge tone="info">Supabase Storage</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted">Bucket</dt>
        <dd className="font-mono">{info.bucket}</dd>
        <dt className="text-muted">Endpoint</dt>
        <dd className="font-mono break-all">{info.endpoint ?? "—"}</dd>
        <dt className="text-muted">Read URLs</dt>
        <dd>{info.kind === "r2" ? (info.public_url ? `public via ${info.public_url}` : "presigned (6 h), bucket stays private") : "signed (6 h)"}</dd>
      </dl>
      {info.kind === "r2" ? (
        <p className="text-xs text-muted">Every generated output, import and upload is copied into this bucket. Apply CORS once so the browser can upload directly and download files.</p>
      ) : (
        <p className="text-xs text-muted">Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to switch to Cloudflare R2 (recommended: no egress fees).</p>
      )}
      <div className="flex flex-wrap gap-2">
        <form action={testAction}>
          <Button type="submit" size="sm" variant="outline" loading={testPending}>
            Test connection
          </Button>
        </form>
        {info.kind === "r2" ? (
          <form action={corsAction}>
            <Button type="submit" size="sm" variant="outline" loading={corsPending}>
              Apply CORS
            </Button>
          </form>
        ) : null}
      </div>
      {latest?.error ? <ErrorBanner title="Storage" message={latest.error} /> : latest?.message ? <InfoBanner>{latest.message}</InfoBanner> : null}
    </section>
  );
}
