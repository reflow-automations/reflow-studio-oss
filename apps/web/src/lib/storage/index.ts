import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { R2StorageBackend, r2ConfigFromEnv } from "@/lib/storage/r2";
import { SupabaseStorageBackend } from "@/lib/storage/supabase";
import type { StorageBackend } from "@/lib/storage/types";

let primary: StorageBackend | undefined;
let fallback: SupabaseStorageBackend | undefined;

/** Primary backend for new objects: R2 when configured, otherwise Supabase Storage. */
export function getStorage(): StorageBackend {
  if (primary) return primary;
  const cfg = r2ConfigFromEnv();
  primary = cfg ? new R2StorageBackend(cfg) : getSupabaseStorage();
  return primary;
}

/** Supabase Storage backend, also used to read assets written before R2 was enabled. */
export function getSupabaseStorage(): SupabaseStorageBackend {
  if (!fallback) fallback = new SupabaseStorageBackend(supabaseAdmin());
  return fallback;
}

/** All backends that may hold assets (primary first). */
export function getStorageBackends(): StorageBackend[] {
  const main = getStorage();
  return main.kind === "r2" ? [main, getSupabaseStorage()] : [main];
}

export interface StorageInfo {
  kind: "r2" | "supabase";
  bucket: string;
  /** R2 only: public base URL when the bucket is served publicly; otherwise presigned URLs are used. */
  public_url: string | null;
  endpoint: string | null;
}

export function describeStorage(): StorageInfo {
  const backend = getStorage();
  if (backend instanceof R2StorageBackend) return { kind: "r2", bucket: backend.bucket, public_url: backend.publicUrl ?? null, endpoint: backend.endpoint };
  return { kind: "supabase", bucket: backend.buckets.media, public_url: null, endpoint: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null };
}

export type { StorageBackend, UploadTarget } from "@/lib/storage/types";
export { R2StorageBackend } from "@/lib/storage/r2";
export { SupabaseStorageBackend } from "@/lib/storage/supabase";
