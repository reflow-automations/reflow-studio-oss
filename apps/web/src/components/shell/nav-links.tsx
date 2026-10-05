"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { NAV_GROUPS, NAV_ITEMS, isNavActive, type NavGroup, type NavItem } from "@/components/shell/nav";

/** Flat list of every navigation item (kept for older imports; prefer NAV_GROUPS). */
export const NAV = NAV_ITEMS;

interface NavItemLinkProps {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  /** Taller rows for touch (the mobile "More" sheet). */
  comfortable?: boolean;
}

/** One sidebar row: 2 px orange bar plus brighter text when active. */
export function NavItemLink({ item, active, onNavigate, comfortable = false }: NavItemLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-sm px-3 text-[13px] font-medium transition-colors",
        comfortable ? "h-11 text-sm" : "h-9",
        active ? "bg-hover text-fg" : "text-muted hover:bg-hover/70 hover:text-fg",
      )}
    >
      <span className={cn("absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden />
      <Icon className={cn("size-4 shrink-0 transition-colors", active ? "text-accent" : "text-subtle group-hover:text-fg-2")} aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

interface NavGroupsProps {
  groups?: readonly NavGroup[];
  onNavigate?: () => void;
  comfortable?: boolean;
  className?: string;
  /** Accessible name of the <nav> landmark. */
  label?: string;
}

/** Grouped navigation with section headings (sidebar and the mobile "More" sheet). */
export function NavGroups({ groups = NAV_GROUPS, onNavigate, comfortable = false, className, label = "Primary" }: NavGroupsProps) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={cn("flex flex-col gap-5", className)}>
      {groups.map((group) => {
        const headingId = `nav-group-${label.toLowerCase().replace(/\s+/g, "-")}-${group.id}`;
        return (
          <div key={group.id} className="flex flex-col gap-0.5" role="group" aria-labelledby={headingId}>
            <p id={headingId} className="px-3 pb-1 text-xs font-medium text-subtle">
              {group.label}
            </p>
            {group.items.map((item) => (
              <NavItemLink key={item.href} item={item} active={isNavActive(pathname, item)} onNavigate={onNavigate} comfortable={comfortable} />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Backwards-compatible entry point. `vertical` renders the grouped sidebar;
 * `horizontal` renders a flat, scrollable icon row whose labels stay readable
 * by screen readers below sm (sr-only instead of display: none).
 */
export function NavLinks({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  if (orientation === "vertical") return <NavGroups />;
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 overflow-x-auto">
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex h-9 shrink-0 items-center gap-2 rounded-sm px-2.5 text-[13px] font-medium transition-colors", active ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg")}
          >
            <Icon className={cn("size-4", active ? "text-accent" : "text-subtle")} aria-hidden />
            <span className="sr-only sm:not-sr-only">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
