import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { isOwnerEmail } from "@/lib/auth/owner";
import type { Database } from "@/lib/db/types";
import { supabasePublicConfig } from "@/lib/supabase/keys";

/** Cookie-backed client for Server Components, Server Actions and Route Handlers (honours RLS). */
export async function supabaseServer() {
  // cookies() first: it marks the route dynamic, so prerendering at build time bails out before the config check.
  const cookieStore = await cookies();
  const config = supabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see /setup).");
  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}

/**
 * Signed-in user regardless of the owner allowlist (login page only).
 * Memoized per request with React `cache()`, so a layout and its page share
 * one Supabase Auth round trip.
 */
export const currentSessionUser = cache(async () => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Current user when they are on the owner allowlist, otherwise null (treated as signed out). Memoized per request. */
export const currentUser = cache(async () => {
  const user = await currentSessionUser();
  if (!user || !isOwnerEmail(user.email)) return null;
  return user;
});
