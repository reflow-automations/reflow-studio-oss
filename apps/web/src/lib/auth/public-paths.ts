/**
 * Path rules for proxy.ts. Pure so they can be unit tested and shared.
 *
 * - "open": served without any Supabase call or login (share pages, the
 *   gallery, metadata files, demo and showcase media). These pages render
 *   only data their own server code chose to publish.
 * - "auth": reachable signed out, but the proxy still refreshes the session
 *   cookie (login, auth callbacks, setup).
 * - "gated": everything else; needs an allowed owner session.
 * API routes are excluded from the proxy matcher and authenticate themselves.
 */

export type PathAccess = "open" | "auth" | "gated";

const AUTH_PREFIXES = ["/login", "/auth", "/setup"] as const;
const OPEN_PREFIXES = ["/s", "/gallery", "/demo", "/showcase"] as const;
const OPEN_FILES = new Set(["/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/manifest.json", "/favicon.ico", "/gallery.json"]);
/**
 * Metadata image routes as Next.js serves them: /icon, /icon0, /icon.svg,
 * /apple-icon, /opengraph-image, /opengraph-image-abc123, /twitter-image.png,
 * /icon/small (generateImageMetadata ids).
 */
const METADATA_IMAGE = /^\/(?:icon|apple-icon|opengraph-image|twitter-image)\d*(?:-[A-Za-z0-9]+)?(?:\.(?:png|jpe?g|gif|svg|ico|webp))?(?:\/[\w-]+)?$/;

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function classifyPath(pathname: string): PathAccess {
  const path = pathname || "/";
  if (OPEN_FILES.has(path) || METADATA_IMAGE.test(path)) return "open";
  if (OPEN_PREFIXES.some((p) => matchesPrefix(path, p))) return "open";
  if (AUTH_PREFIXES.some((p) => matchesPrefix(path, p))) return "auth";
  return "gated";
}

/** True for paths a signed-out visitor may load (open or auth). */
export function isPublicPath(pathname: string): boolean {
  return classifyPath(pathname) !== "gated";
}
