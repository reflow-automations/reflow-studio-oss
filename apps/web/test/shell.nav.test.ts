import { describe, expect, it } from "vitest";
import { MORE_GROUPS, NAV_GROUPS, NAV_ITEMS, TAB_BAR_ITEMS, isMoreActive, isNavActive } from "@/components/shell/nav";

const item = (href: string) => {
  const found = NAV_ITEMS.find((i) => i.href === href);
  if (!found) throw new Error(`missing nav item ${href}`);
  return found;
};

describe("navigation model", () => {
  it("groups the studio into Create, Library, Explore and Settings", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Create", "Library", "Explore", "Settings"]);
    expect(NAV_GROUPS.find((g) => g.id === "settings")?.items.map((i) => i.label)).toEqual(["Providers", "API keys", "Usage"]);
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
  });

  it("puts the main destinations in the tab bar and the rest in the More sheet", () => {
    expect(TAB_BAR_ITEMS.map((i) => i.tabLabel ?? i.label)).toEqual(["Image", "Video", "Library", "Assets"]);
    const more = MORE_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(more).toEqual(["/models", "/settings/providers", "/settings/api-keys", "/usage"]);
    // Every item is reachable on mobile exactly once.
    expect([...TAB_BAR_ITEMS.map((i) => i.href), ...more].sort()).toEqual(NAV_ITEMS.map((i) => i.href).sort());
    expect(MORE_GROUPS.every((g) => g.items.length > 0)).toBe(true);
  });

  it("matches a page and its sub pages on segment boundaries", () => {
    expect(isNavActive("/library", item("/library"))).toBe(true);
    expect(isNavActive("/library/", item("/library"))).toBe(true);
    expect(isNavActive("/library-old", item("/library"))).toBe(false);
    expect(isNavActive("/create/image", item("/create/video"))).toBe(false);
    expect(isNavActive("/settings/providers/fal", item("/settings/providers"))).toBe(true);
    expect(isNavActive(null, item("/library"))).toBe(false);
  });

  it("highlights Library on a generation detail page", () => {
    expect(isNavActive("/generations/0b6f3c1e", item("/library"))).toBe(true);
    expect(isNavActive("/generations", item("/assets"))).toBe(false);
  });

  it("marks More active only for pages outside the tab bar", () => {
    expect(isMoreActive("/models")).toBe(true);
    expect(isMoreActive("/settings/api-keys")).toBe(true);
    expect(isMoreActive("/create/image")).toBe(false);
    expect(isMoreActive("/generations/abc")).toBe(false);
    expect(isMoreActive(undefined)).toBe(false);
  });
});
