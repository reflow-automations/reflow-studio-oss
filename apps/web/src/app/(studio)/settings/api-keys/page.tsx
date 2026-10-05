import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Bot } from "lucide-react";
import { appBaseUrl } from "@/lib/env";
import { currentUser, supabaseServer } from "@/lib/supabase/server";
import { formatDate } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/banner";
import { ApiKeyForm } from "@/components/settings/api-key-form";
import { RevokeKeyButton } from "@/components/settings/revoke-key-button";
import { McpSnippets } from "@/components/settings/mcp-snippets";

export const metadata: Metadata = { title: "API keys" };
export const dynamic = "force-dynamic";

/** Expiry check kept outside the component so render stays pure (react-hooks/purity). */
function hasExpired(expiresAt: string | null): boolean {
  return expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
}

export default async function ApiKeysPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/api-keys");
  const supabase = await supabaseServer();
  const { data: keys, error } = await supabase
    .from("api_keys")
    .select("id, name, prefix, scopes, last_used_at, expires_at, revoked_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const origin = appBaseUrl();

  return (
    <div className="flex flex-col">
      <PageHeader title="API keys" description="Bearer keys for the REST API and the MCP endpoint. Secrets are shown once." />
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-6">
          <ApiKeyForm origin={origin} />

          <section aria-label="Existing keys" className="overflow-hidden rounded-lg border border-border bg-elevated">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold">Your keys</h2>
            </div>
            {error ? (
              <div className="p-4">
                <ErrorBanner title="Could not load keys" message={error.message} />
              </div>
            ) : !keys || keys.length === 0 ? (
              <p className="p-4 text-xs text-muted">No API keys yet. Create one above to connect Claude Code, Cursor or scripts.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead className="bg-bg text-[11px] tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Name</th>
                      <th scope="col" className="px-4 py-2 font-medium">Prefix</th>
                      <th scope="col" className="px-4 py-2 font-medium">Scopes</th>
                      <th scope="col" className="px-4 py-2 font-medium">Last used</th>
                      <th scope="col" className="px-4 py-2 font-medium">Expires</th>
                      <th scope="col" className="px-4 py-2 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {keys.map((k) => {
                      const expired = hasExpired(k.expires_at);
                      const active = !k.revoked_at && !expired;
                      return (
                        <tr key={k.id} className={active ? undefined : "opacity-60"}>
                          <td className="px-4 py-2 font-medium">{k.name}</td>
                          <td className="px-4 py-2 font-mono">{k.prefix}…</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap gap-1">
                              {k.scopes.map((s) => (
                                <Badge key={s} tone="outline">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap text-muted">{k.last_used_at ? formatDate(k.last_used_at) : "never"}</td>
                          <td className="px-4 py-2 whitespace-nowrap text-muted">{k.expires_at ? formatDate(k.expires_at) : "never"}</td>
                          <td className="px-4 py-2">{k.revoked_at ? <Badge tone="danger">revoked</Badge> : expired ? <Badge tone="warning">expired</Badge> : <Badge tone="success">active</Badge>}</td>
                          <td className="px-4 py-2 text-right">{active ? <RevokeKeyButton id={k.id} name={k.name} /> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-3 rounded-lg border border-border bg-elevated p-4" aria-label="Connect to MCP">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-accent" aria-hidden />
            <h2 className="text-sm font-semibold">Connect to MCP</h2>
          </div>
          <p className="text-xs text-muted">
            Point an MCP client at <code className="font-mono text-fg">{origin}/api/mcp</code> with a Bearer key. Replace the placeholder with a real key.
          </p>
          <McpSnippets origin={origin} />
        </aside>
      </div>
    </div>
  );
}
