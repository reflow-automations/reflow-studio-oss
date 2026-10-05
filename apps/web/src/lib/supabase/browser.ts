"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/types";
import { supabasePublicConfig } from "@/lib/supabase/keys";

let cached: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function supabaseBrowser() {
  if (cached) return cached;
  const config = supabasePublicConfig();
  if (!config) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or the Vercel integration's NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).");
  cached = createBrowserClient<Database>(config.url, config.key);
  return cached;
}
