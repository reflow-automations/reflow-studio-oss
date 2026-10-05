import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * Baseline security headers for every response.
 *
 * The CSP only sets the directives that cannot break anything this app loads:
 * no framing (clickjacking on the settings pages that show one-time secrets),
 * no <base> hijacking and no plugins. script-src / img-src / media-src /
 * connect-src are deliberately not restricted: Next.js inline bootstrap
 * scripts would need per-request nonces (which disables static rendering),
 * and media comes from hosts that differ per deployment (the member's own
 * Supabase project, R2 bucket or custom domain, presigned R2 URLs, fal and
 * Kie CDNs for provider previews), while next/og and the Supabase browser
 * client need their own origins. A wrong allowlist would silently blank out
 * generated media, so it is left to members who know their hosts.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@reflow/core"],
  images: {
    remotePatterns: [
      ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost }] : []),
      { protocol: "https", hostname: "**.fal.media" },
      { protocol: "https", hostname: "**.aiquickdraw.com" },
    ],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // Vercel caps request bodies at 4.5 MB; match it locally so uploads fail the same way in dev.
    proxyClientMaxBodySize: "4mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
