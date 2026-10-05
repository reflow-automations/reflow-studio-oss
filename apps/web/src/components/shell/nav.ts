import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Boxes, Clapperboard, Gauge, Image as ImageIcon, KeyRound, Layers, LayoutGrid, Plug } from "lucide-react";

/**
 * Navigation model shared by the desktop sidebar and the mobile tab bar.
 * Pure data plus one matcher, so it can be unit tested and extended by forks
 * (add an item here and both navigations pick it up).
 */

export interface NavItem {
  href: Route;
  label: string;
  /** Shorter label for the mobile tab bar. */
  tabLabel?: string;
  icon: LucideIcon;
  /** Extra path prefixes that mark this item active (detail pages that live elsewhere). */
  match?: readonly string[];
}

export interface NavGroup {
  id: "create" | "library" | "explore" | "settings";
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: "create",
    label: "Create",
    items: [
      { href: "/create/image", label: "Image", icon: ImageIcon },
      { href: "/create/video", label: "Video", icon: Clapperboard },
    ],
  },
  {
    id: "library",
    label: "Library",
    items: [
      { href: "/library", label: "Generations", tabLabel: "Library", icon: LayoutGrid, match: ["/generations"] },
      { href: "/assets", label: "Assets", icon: Layers },
    ],
  },
  {
    id: "explore",
    label: "Explore",
    items: [{ href: "/models", label: "Models", icon: Boxes }],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      { href: "/settings/providers", label: "Providers", icon: Plug },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound },
      { href: "/usage", label: "Usage", icon: Gauge },
    ],
  },
];

/** Every item in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Items that get their own tab on mobile; everything else lives in the "More" sheet. */
export const TAB_BAR_HREFS: readonly Route[] = ["/create/image", "/create/video", "/library", "/assets"];

export const TAB_BAR_ITEMS: readonly NavItem[] = TAB_BAR_HREFS.map((href) => NAV_ITEMS.find((item) => item.href === href)).filter((item): item is NavItem => Boolean(item));

/** Groups minus the tab-bar items, for the mobile "More" sheet. Empty groups are dropped. */
export const MORE_GROUPS: readonly NavGroup[] = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !TAB_BAR_HREFS.includes(item.href)) })).filter((group) => group.items.length > 0);

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `pathname` is the item's page or one of its sub pages (segment-aware: /library does not match /library-old). */
export function isNavActive(pathname: string | null | undefined, item: Pick<NavItem, "href" | "match">): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return underPrefix(path, item.href) || (item.match ?? []).some((prefix) => underPrefix(path, prefix));
}

/** Whether the current page belongs in the "More" sheet (so the More tab shows as active). */
export function isMoreActive(pathname: string | null | undefined): boolean {
  return MORE_GROUPS.some((group) => group.items.some((item) => isNavActive(pathname, item)));
}
