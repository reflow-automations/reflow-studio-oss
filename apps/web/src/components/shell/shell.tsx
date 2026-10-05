import type { ReactNode } from "react";
import type { Route } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavGroups } from "@/components/shell/nav-links";
import { MobileNav } from "@/components/shell/mobile-nav";
import { BalanceSummary } from "@/components/shell/balance-summary";
import { AccountSummary } from "@/components/shell/account-summary";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { Banner } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

interface ShellProps {
  email: string;
  /** Workspace display name, or null when the account has no membership yet. */
  workspace: string | null;
  /** Show the "Demo mode" pill (mock provider enabled). */
  demoMode?: boolean;
  /** Optional strip above the page content, for app-wide notices such as a setup checklist. */
  banner?: ReactNode;
  children: ReactNode;
}

const HOME: Route = "/create/image";

function DemoPill() {
  return (
    <Badge tone="accent" dot title="Demo mode: generations are simulated and no provider is charged.">
      <FlaskConical className="size-3" aria-hidden />
      Demo
    </Badge>
  );
}

function DemoNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-fg-2">
      <FlaskConical className="mt-px size-3.5 shrink-0 text-accent" aria-hidden />
      <p>
        <span className="font-medium text-fg">Demo mode.</span> Generations are simulated and no provider is charged.
      </p>
    </div>
  );
}

/**
 * App frame. lg and up: a sticky sidebar with grouped navigation, the spend
 * card and the account row. Below lg: a slim top bar (logo, spend pill) and a
 * fixed bottom tab bar; <main> is padded by the tab bar height
 * (var(--spacing-tabbar) plus the safe-area inset) so content never hides
 * behind it. Fixed bottom UI inside pages should sit at
 * bottom-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] lg:bottom-0.
 */
export function Shell({ email, workspace, demoMode = false, banner, children }: ShellProps) {
  return (
    <div className="flex min-h-dvh w-full">
      {/* Parked above the viewport until focused (no sr-only, whose position: static on focus would push the layout). */}
      <a href="#main" className={buttonClasses({ variant: "secondary", size: "sm", className: "fixed top-3 left-3 z-50 -translate-y-24 focus:translate-y-0" })}>
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-panel lg:flex">
        <div className="flex h-16 items-center px-4">
          <Link href={HOME} className="-m-1 min-w-0 rounded-sm p-1">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pt-2 pb-4">
          <NavGroups />
        </div>
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {demoMode ? <DemoNotice /> : null}
          <BalanceSummary />
          <div className="flex items-center justify-between gap-2">
            <AccountSummary email={email} workspace={workspace} />
            <SignOutButton iconOnly />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-panel/90 px-4 backdrop-blur-md lg:hidden">
          <Link href={HOME} className="-m-1 min-w-0 rounded-sm p-1">
            <Logo markSize={26} />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            {demoMode ? <DemoPill /> : null}
            <BalanceSummary compact />
          </div>
        </header>

        {banner}
        {workspace === null ? (
          <div className="px-4 pt-4 sm:px-6">
            <Banner
              tone="warning"
              title="This account has no workspace yet"
              action={
                <Link href="/setup" className={buttonClasses({ variant: "outline", size: "sm" })}>
                  Open setup checklist
                </Link>
              }
            >
              Accounts get a workspace when they are created after the database migrations have run. Run the setup checklist to see what is missing, then sign out and back in.
            </Banner>
          </div>
        ) : null}

        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col pb-[calc(var(--spacing-tabbar)+env(safe-area-inset-bottom))] outline-none lg:pb-0">
          {children}
        </main>
      </div>

      <MobileNav email={email} workspace={workspace} />
    </div>
  );
}
