/**
 * Instance branding shared by the root metadata, the app shell, the login
 * page, the manifest and the generated OG images. Pure module (no React, no
 * server-only imports) so metadata files, client components and tests can all
 * use it.
 */

/** Display name of this studio. Forks rename it with NEXT_PUBLIC_STUDIO_NAME. */
export const STUDIO_NAME = process.env.NEXT_PUBLIC_STUDIO_NAME?.trim() || "Reflow Studio";

export const STUDIO_HEADLINE = "Your own AI image and video studio.";
export const STUDIO_TAGLINE = `${STUDIO_HEADLINE} Bring your own keys.`;
export const STUDIO_DESCRIPTION = "Open-source, self-hosted studio for AI images and video. Bring your own fal.ai, Kie.ai or Higgsfield API keys; prompts, outputs and spend stay in your own Supabase project.";

/** Home-screen label: launchers cut names off after about 12 characters, so long names keep their first word. */
export function shortStudioName(name: string = STUDIO_NAME): string {
  const trimmed = name.trim();
  if (trimmed.length <= 12) return trimmed;
  return (trimmed.split(/\s+/)[0] ?? trimmed).slice(0, 12);
}

/**
 * Brand colours as plain hex for places that cannot read CSS variables
 * (ImageResponse, the web manifest, the viewport theme colour). Keep in sync
 * with the @theme block in app/globals.css.
 */
export const BRAND = {
  bg: "#0A0D14",
  panel: "#0F141E",
  elevated: "#151B27",
  border: "#262F40",
  borderStrong: "#3A4558",
  fg: "#F4F4F5",
  fg2: "#C9CDD6",
  muted: "#9AA3B2",
  subtle: "#7D8697",
  accent: "#F7951D",
  accentStrong: "#E0811A",
  ink: "#020617",
} as const;

/**
 * Public base URL of this deployment, used as `metadataBase` so OG image and
 * canonical URLs are absolute. Order: APP_BASE_URL, VERCEL_PROJECT_PRODUCTION_URL,
 * VERCEL_URL, then localhost. Invalid values are skipped instead of throwing,
 * because this runs while rendering every page.
 */
export function siteBaseUrl(env: Record<string, string | undefined> = process.env): URL {
  const candidates = [env.APP_BASE_URL, withScheme(env.VERCEL_PROJECT_PRODUCTION_URL), withScheme(env.VERCEL_URL)];
  for (const candidate of candidates) {
    const url = parseHttpUrl(candidate);
    if (url) return url;
  }
  return new URL("http://localhost:3000");
}

function withScheme(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function parseHttpUrl(value: string | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // metadataBase is an origin plus optional base path; drop query, hash and trailing slashes.
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url;
  } catch {
    return null;
  }
}
