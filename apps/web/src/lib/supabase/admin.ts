import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/db/types";

let cached: SupabaseClient<Database> | undefined;

/**
 * Service-role client for server-side orchestration (bypasses RLS; never expose
 * to the browser). Accepts the legacy service_role key or the newer secret key
 * (`SUPABASE_SECRET_KEY` from the Vercel integration); env.ts resolves the names.
 */
export function supabaseAdmin(): SupabaseClient<Database> {
  if (cached) return cached;
  const e = env();
  cached = createClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
