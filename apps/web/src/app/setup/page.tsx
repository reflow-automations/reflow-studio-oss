import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowRight, BookOpen, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { getSetupStatus, type SetupItem, type SetupItemStatus, type SetupStatus } from "@/lib/setup/status";
import { AuthFrame } from "@/components/auth/auth-frame";
import { OwnerForm } from "@/components/setup/owner-form";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "Set up your studio" };

const DOCS_URL = "https://github.com/reflow-automations/reflow-studio-oss/blob/main/docs/SETUP.md";

const STATUS: Record<SetupItemStatus, { tone: BadgeTone; label: string; Icon: typeof CircleCheck; icon: string }> = {
  ok: { tone: "success", label: "OK", Icon: CircleCheck, icon: "text-success" },
  warn: { tone: "warning", label: "Check", Icon: TriangleAlert, icon: "text-warning" },
  missing: { tone: "danger", label: "Missing", Icon: CircleAlert, icon: "text-danger" },
};

function ChecklistItem({ item }: { item: SetupItem }) {
  const s = STATUS[item.status];
  return (
    <li className="flex gap-3 py-3">
      <s.Icon className={cn("mt-0.5 size-4 shrink-0", s.icon)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-fg">{item.label}</p>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <p className="mt-1 text-xs break-words text-muted">{item.hint}</p>
        {item.docsAnchor && item.status !== "ok" ? (
          <a href={`${DOCS_URL}#${item.docsAnchor}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline hover:underline-offset-4">
            <BookOpen className="size-3.5" aria-hidden />
            How to fix this
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** getSetupStatus never throws by contract; this is the last line of defence for a public page. */
async function loadStatus(): Promise<SetupStatus | null> {
  try {
    return await getSetupStatus();
  } catch {
    return null;
  }
}

export default async function SetupPage(props: PageProps<"/setup">) {
  // Always render per request: the checklist reflects the live environment and database.
  await connection();
  const params = await props.searchParams;
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const status = await loadStatus();
  const supabaseReady = status?.items.find((i) => i.id === "supabase")?.status === "ok";
  const missing = status?.items.filter((i) => i.status === "missing").length ?? 0;

  return (
    <AuthFrame
      footer={
        <p className="mx-auto flex w-full max-w-sm flex-wrap items-center justify-center gap-x-1.5 text-[13px] text-muted lg:justify-start">
          Need the full guide?
          <a href={DOCS_URL} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline hover:underline-offset-4">
            Read docs/SETUP.md
          </a>
        </p>
      }
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-semibold text-fg">Set up your studio</h1>
        <p className="text-sm text-muted">This checklist reads your environment and database. It never shows secret values.</p>
      </div>

      {reason === "supabase_not_configured" ? (
        <Banner tone="warning" title="Supabase is not configured">
          Add the Supabase environment variables below and redeploy. Every other page stays closed until then.
        </Banner>
      ) : null}

      {status?.demoMode ? (
        <Banner tone="info" title="Demo mode is on">
          ENABLE_MOCK_PROVIDER is set, so generations use free placeholder outputs until you add a provider key.
        </Banner>
      ) : null}

      <section aria-labelledby="setup-checklist" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="setup-checklist" className="text-base font-semibold text-fg">
            Checklist
          </h2>
          {status ? (
            <Badge tone={missing ? "danger" : "success"} size="md" dot>
              {missing ? `${missing} to fix` : "Ready"}
            </Badge>
          ) : null}
        </div>
        {status ? (
          <ul className="divide-y divide-border rounded-md border border-border bg-panel px-3.5">
            {status.items.map((item) => (
              <ChecklistItem key={item.id} item={item} />
            ))}
          </ul>
        ) : (
          <Banner tone="danger" title="The checklist could not run">
            Check the server logs, then reload this page.
          </Banner>
        )}
      </section>

      {status?.ownerExists ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-2">An owner account exists. Sign in to start creating.</p>
          <Link href="/login" className={buttonClasses({ variant: "primary", size: "lg", className: "w-full" })}>
            Go to sign in
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      ) : supabaseReady ? (
        <section aria-labelledby="setup-owner" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="setup-owner" className="text-base font-semibold text-fg">
              Create the owner account
            </h2>
            <p className="text-sm text-muted">No e-mail confirmation needed. You can do this once, with the deploy secret.</p>
          </div>
          <OwnerForm />
        </section>
      ) : (
        <p className="text-sm text-muted">Once Supabase is connected, you can create the owner account here.</p>
      )}
    </AuthFrame>
  );
}
