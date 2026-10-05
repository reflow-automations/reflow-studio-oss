import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { BRAND, shortStudioName, siteBaseUrl } from "@/components/brand/site";
import { SHOWCASE_IMAGES, balanceColumns } from "@/components/brand/showcase";
import { fontUrlFromCss, googleFontCssUrl, loadGoogleFont } from "@/components/brand/og-fonts";

describe("siteBaseUrl", () => {
  it("prefers APP_BASE_URL and normalises it to an origin plus base path", () => {
    expect(siteBaseUrl({ APP_BASE_URL: "https://studio.example.org/?x=1#top", VERCEL_PROJECT_PRODUCTION_URL: "p.vercel.app" }).href).toBe("https://studio.example.org/");
    expect(siteBaseUrl({ APP_BASE_URL: "https://example.org/studio///" }).href).toBe("https://example.org/studio");
  });

  it("falls back to the Vercel production host, then the deployment host, then localhost", () => {
    expect(siteBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "my-studio.vercel.app", VERCEL_URL: "x.vercel.app" }).href).toBe("https://my-studio.vercel.app/");
    expect(siteBaseUrl({ VERCEL_URL: "my-studio-git-main.vercel.app" }).href).toBe("https://my-studio-git-main.vercel.app/");
    expect(siteBaseUrl({}).href).toBe("http://localhost:3000/");
  });

  it("skips blank and invalid values instead of throwing", () => {
    expect(siteBaseUrl({ APP_BASE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "my-studio.vercel.app" }).host).toBe("my-studio.vercel.app");
    expect(siteBaseUrl({ APP_BASE_URL: "not a url" }).href).toBe("http://localhost:3000/");
    expect(siteBaseUrl({ APP_BASE_URL: "ftp://files.example.org" }).href).toBe("http://localhost:3000/");
  });
});

describe("brand constants", () => {
  it("keeps short names within launcher limits", () => {
    expect(shortStudioName("Reflow Studio")).toBe("Reflow");
    expect(shortStudioName("My Studio")).toBe("My Studio");
    expect(shortStudioName("Supercalifragilistic Studio")).toBe("Supercalifra");
  });

  it("uses the validated palette", () => {
    expect(BRAND.accent).toBe("#F7951D");
    expect(BRAND.ink).toBe("#020617");
    expect(BRAND.bg).toBe("#0A0D14");
  });
});

describe("showcase", () => {
  it("ships every listed image in public/showcase", () => {
    for (const image of SHOWCASE_IMAGES) {
      const file = fileURLToPath(new URL(`../public${image.src}`, import.meta.url));
      expect(existsSync(file), image.src).toBe(true);
      expect(image.alt.length).toBeGreaterThan(0);
    }
  });

  it("balances columns by height and keeps every item once", () => {
    const items = [
      { id: "tall", width: 1, height: 3 },
      { id: "a", width: 1, height: 1 },
      { id: "b", width: 1, height: 1 },
      { id: "c", width: 1, height: 1 },
    ];
    expect(balanceColumns(items, 2).map((c) => c.map((i) => i.id))).toEqual([["tall"], ["a", "b", "c"]]);
    expect(balanceColumns(SHOWCASE_IMAGES, 3).flat()).toHaveLength(SHOWCASE_IMAGES.length);
    expect(balanceColumns(items, 0)).toHaveLength(1);
  });
});

describe("OG font loading", () => {
  it("extracts a non-woff2 source from Google Fonts CSS", () => {
    const css = "@font-face { font-family: 'Inter'; src: url(https://fonts.gstatic.com/l/font?kit=abc) format('truetype'); }";
    expect(fontUrlFromCss(css)).toBe("https://fonts.gstatic.com/l/font?kit=abc");
    expect(fontUrlFromCss("src: url(https://x/y.woff2) format('woff2');")).toBeNull();
  });

  it("subsets the request to the given text", () => {
    expect(googleFontCssUrl("Inter", 600, "Hi!")).toBe("https://fonts.googleapis.com/css2?family=Inter:wght@600&text=Hi!");
  });

  it("returns null instead of failing the build when the network is unavailable", async () => {
    const offline = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(loadGoogleFont("Inter", 400, "abc", offline)).resolves.toBeNull();
    const notFound = vi.fn().mockResolvedValue(new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(loadGoogleFont("Inter", 400, "abc", notFound)).resolves.toBeNull();
  });
});
