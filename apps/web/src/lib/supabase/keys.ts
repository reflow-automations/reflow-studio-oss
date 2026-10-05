/**
 * Supabase URL and publishable key for the browser, the proxy and the cookie
 * client. The `process.env.NEXT_PUBLIC_*` reads are written out literally so
 * Next.js inlines them into client bundles.
 *
 * Name sets, explicit names first:
 * - URL: NEXT_PUBLIC_SUPABASE_URL, then SUPABASE_URL (server only).
 * - Publishable key: NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy anon key), then
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Vercel Supabase integration), then
 *   SUPABASE_PUBLISHABLE_KEY (server only).
 * Empty strings count as unset.
 */

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || (typeof window === "undefined" ? process.env.SUPABASE_URL : undefined) || undefined;
}

export function supabasePublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || (typeof window === "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined) || undefined;
}

/** Both public values, or null when the deployment has no Supabase configuration yet. */
export function supabasePublicConfig(): { url: string; key: string } | null {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  return url && key ? { url, key } : null;
}
