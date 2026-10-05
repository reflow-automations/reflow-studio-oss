import type { MetadataRoute } from "next";

/**
 * A studio is private by default: crawlers may only reach opt-in public pages
 * (share links under /s/ and the gallery) plus the brand images their link
 * previews point at. Every page also sends noindex unless it opts in (see the
 * robots default in app/layout.tsx).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/s/", "/gallery", "/opengraph-image", "/twitter-image", "/icon", "/apple-icon"], disallow: "/" }],
  };
}
