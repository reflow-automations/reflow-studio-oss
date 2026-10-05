import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyPath, isPublicPath } from "@/lib/auth/public-paths";
import { supabasePublicConfig, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/keys";
import { proxy } from "@/proxy";

const SUPABASE_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of SUPABASE_VARS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of SUPABASE_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("classifyPath", () => {
  it("serves share pages, the gallery, metadata files and demo media without Supabase", () => {
    for (const path of ["/s/abcdefghijklmnopqrstuv", "/s/abc/opengraph-image", "/s/abc/manifest.json", "/gallery", "/gallery/page/2", "/gallery.json", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/opengraph-image", "/twitter-image", "/icon", "/icon.svg", "/icon0", "/apple-icon", "/opengraph-image-a1b2c3", "/demo/hero.mp4", "/showcase/mug.webp"]) {
      expect(classifyPath(path), path).toBe("open");
    }
  });

  it("keeps login, auth callbacks and setup reachable signed out", () => {
    for (const path of ["/login", "/auth/callback", "/setup", "/setup/owner"]) expect(classifyPath(path), path).toBe("auth");
  });

  it("gates the studio, including look-alike paths", () => {
    for (const path of ["/", "/create/image", "/settings/providers", "/settings", "/sx", "/galleryx", "/setupx", "/loginx", "/icons", "/library"]) {
      expect(classifyPath(path), path).toBe("gated");
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("Supabase public config", () => {
  it("accepts the legacy anon key, then the integration's publishable key", () => {
    expect(supabasePublicConfig()).toBeNull();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    expect(supabasePublicConfig()).toEqual({ url: "https://abc.supabase.co", key: "sb_publishable_x" });
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon";
    expect(supabasePublishableKey()).toBe("legacy-anon");
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    expect(supabasePublishableKey()).toBe("sb_publishable_x");
  });

  it("falls back to the server-only SUPABASE_URL", () => {
    process.env.SUPABASE_URL = "https://server.supabase.co";
    expect(supabaseUrl()).toBe("https://server.supabase.co");
  });
});

describe("proxy", () => {
  const request = (path: string) => new NextRequest(new URL(path, "https://studio.test"));

  it("lets open paths through without touching Supabase", async () => {
    const response = await proxy(request("/s/abcdefghijklmnopqrstuv"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends every gated page to /setup while Supabase is not configured (fail closed)", async () => {
    const response = await proxy(request("/create/image"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/setup");
    expect(location.searchParams.get("reason")).toBe("supabase_not_configured");
    const login = await proxy(request("/login"));
    expect(new URL(login.headers.get("location")!).pathname).toBe("/setup");
  });

  it("serves /setup itself while Supabase is not configured", async () => {
    const response = await proxy(request("/setup"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects signed-out visitors to /login with the original path", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_abcdefghijklmnop";
    const response = await proxy(request("/library?q=fox"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/library?q=fox");
    const setup = await proxy(request("/setup"));
    expect(setup.headers.get("location")).toBeNull();
  });
});
