import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { workspaceForUser } from "@/lib/auth/principal";
import { ownerEmails } from "@/lib/auth/owner";
import { studioStatus } from "@/lib/settings/status";
import { currentUser } from "@/lib/supabase/server";
import { formatUsd } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/banner";
import { ProviderKeyCard } from "@/components/settings/provider-key-card";
import { ProviderPreferenceForm } from "@/components/settings/provider-preference-form";
import { StorageCard } from "@/components/settings/storage-card";

export const metadata: Metadata = { title: "Providers" };
export const dynamic = "force-dynamic";

export default async function ProvidersPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/providers");
  const workspace = await workspaceForUser(user.id);
  if (!workspace) {
    return (
      <div className="p-6">
        <ErrorBanner title="No workspace" message="Your account is not attached to a workspace yet." />
      </div>
    );
  }
  const status = await studioStatus(workspace.id);
  const owners = ownerEmails();

  return (
    <div className="flex flex-col">
      <PageHeader title="Providers" description="Provider API keys, routing preference and storage. Keys are encrypted at rest and used by the web app, the REST API and the MCP server alike." />
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          {status.providers.map((item) => (
            <ProviderKeyCard key={item.provider} item={item} encryptionReady={status.encryption_configured} />
          ))}
          <ProviderPreferenceForm current={status.provider_preference} />
        </div>
        <aside className="flex flex-col gap-4">
          <StorageCard info={status.storage} />
          <section aria-label="Access" className="flex flex-col gap-2 rounded-lg border border-border bg-elevated p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent" aria-hidden />
              <h2 className="text-sm font-semibold">Access</h2>
            </div>
            {owners.length > 0 ? (
              <p className="text-xs text-muted">
                Only these accounts can sign in or use API keys:{" "}
                {owners.map((e) => (
                  <Badge key={e} tone="outline" className="mr-1">
                    {e}
                  </Badge>
                ))}
              </p>
            ) : (
              <ErrorBanner title="Open access" message="OWNER_EMAILS is not set: in development anyone with a Supabase account can sign in. Set it before deploying." />
            )}
            <p className="text-xs text-muted">MCP clients authenticate with Bearer API keys from Settings → API keys; those keys inherit these provider keys automatically.</p>
          </section>
          <section aria-label="Budget" className="flex flex-col gap-1 rounded-lg border border-border bg-elevated p-4 text-xs">
            <h2 className="text-sm font-semibold">This month</h2>
            <p className="text-muted">
              Spent {formatUsd(status.month_to_date_usd)}
              {status.reserved_usd > 0 ? ` (+${formatUsd(status.reserved_usd)} reserved)` : ""}
              {status.monthly_budget_usd ? ` of a ${formatUsd(status.monthly_budget_usd)} cap` : " — no monthly cap (MONTHLY_BUDGET_USD)"}
            </p>
            {status.mock_provider_enabled ? <Badge tone="warning">mock provider enabled</Badge> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
