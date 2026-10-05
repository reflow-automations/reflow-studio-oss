/**
 * Storage abstraction for media bytes (generated outputs, imports, uploads).
 *
 * Two backends exist: Cloudflare R2 (S3-compatible, the production default)
 * and Supabase Storage (fallback when R2 is
 * not configured). `media_assets.bucket` records which bucket holds an object
 * so reads keep working after switching backends.
 */

export type StorageKind = "r2" | "supabase";

export interface UploadTarget {
  url: string;
  method: "PUT";
  /** Headers the client must send with the PUT. */
  headers: Record<string, string>;
  /** Supabase signed-upload token (absent for R2 presigned URLs). */
  token?: string;
  expires_at: string;
}

export interface StorageStat {
  bytes: number | null;
  contentType: string | null;
}

export interface StorageBackend {
  readonly kind: StorageKind;
  /** Bucket names recorded in `media_assets.bucket` for copies/imports (`media`) and client uploads (`uploads`). */
  readonly buckets: { media: string; uploads: string };
  /** True when this backend can read objects recorded under `bucket`. */
  owns(bucket: string): boolean;
  put(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Readable URL for providers/browsers (public or time-limited). */
  readUrl(bucket: string, key: string): Promise<string | null>;
  createUploadTarget(bucket: string, key: string, contentType: string): Promise<UploadTarget>;
  /** Object metadata, or null when it does not exist. */
  stat(bucket: string, key: string): Promise<StorageStat | null>;
  delete(bucket: string, key: string): Promise<void>;
}

/** Signed/presigned read URLs stay valid this long. */
export const READ_URL_TTL_SECONDS = 6 * 60 * 60;
/** Presigned upload URLs stay valid this long. */
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Object key layout shared by both backends: `<workspace>/<yyyy>/<mm>/<assetId>.<ext>`
 * (workspace first so bucket listings and Supabase RLS stay readable; month so
 * listings stay small).
 */
export function objectKey(workspaceId: string, assetId: string, ext: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${workspaceId}/${yyyy}/${mm}/${assetId}.${ext}`;
}
