"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Modal } from "@/components/ui/modal";
import { BalanceSummary } from "@/components/shell/balance-summary";
import { NavGroups } from "@/components/shell/nav-links";
import { MORE_GROUPS, TAB_BAR_ITEMS, isMoreActive, isNavActive } from "@/components/shell/nav";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { AccountSummary } from "@/components/shell/account-summary";

const tabClass = "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors";

/**
 * Bottom tab bar below lg: the main destinations with labels, plus a "More"
 * sheet for everything else (models, settings, usage, account, sign out).
 * Pages pad their bottom edge with the --spacing-tabbar token (see Shell).
 */
export function MobileNav({ email, workspace }: { email: string; workspace: string | null }) {
  const pathname = usePathname();
  // The sheet remembers the path it was opened on, so any navigation (a nav row,
  // the spend card, the browser back button) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn !== null && openedOn === pathname;
  const close = () => setOpenedOn(null);
  const moreActive = isMoreActive(pathname);

  return (
    <>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="mx-auto flex h-tabbar max-w-xl items-stretch px-1">
          {TAB_BAR_ITEMS.map((item) => {
            const active = isNavActive(pathname, item);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex min-w-0 flex-1">
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn(tabClass, active ? "text-fg" : "text-muted hover:text-fg")}>
                  <span className={cn("absolute top-0 h-0.5 w-8 rounded-full bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden />
                  <Icon className={cn("size-5", active ? "text-accent" : undefined)} aria-hidden />
                  <span className="truncate">{item.tabLabel ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex min-w-0 flex-1">
            <button type="button" onClick={() => setOpenedOn(pathname)} aria-haspopup="dialog" aria-expanded={open} className={cn(tabClass, moreActive ? "text-fg" : "text-muted hover:text-fg")}>
              <span className={cn("absolute top-0 h-0.5 w-8 rounded-full bg-accent transition-opacity", moreActive ? "opacity-100" : "opacity-0")} aria-hidden />
              <Menu className={cn("size-5", moreActive ? "text-accent" : undefined)} aria-hidden />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={open} onClose={close} title="Menu" variant="sheet" bodyClassName="flex flex-col gap-5 px-3 pb-5">
        <NavGroups groups={MORE_GROUPS} onNavigate={close} comfortable label="More" />
        <BalanceSummary />
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-elevated px-3 py-2.5">
          <AccountSummary email={email} workspace={workspace} />
          <SignOutButton variant="outline" />
        </div>
      </Modal>
    </>
  );
}
