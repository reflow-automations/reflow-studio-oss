import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { READ_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS, type StorageBackend, type StorageStat, type UploadTarget } from "@/lib/storage/types";

/** Supabase Storage (private buckets `media` / `uploads`, signed URLs). Used when R2 is not configured. */
export class SupabaseStorageBackend implements StorageBackend {
  readonly kind = "supabase" as const;
  readonly buckets = { media: "media", uploads: "uploads" };

  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  owns(bucket: string): boolean {
    return bucket === this.buckets.media || bucket === this.buckets.uploads;
  }

  async put(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.db.storage.from(bucket).upload(key, bytes, { contentType, upsert: true });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  async readUrl(bucket: string, key: string): Promise<string | null> {
    const { data } = await this.db.storage.from(bucket).createSignedUrl(key, READ_URL_TTL_SECONDS);
    return data?.signedUrl ?? null;
  }

  async createUploadTarget(bucket: string, key: string, contentType: string): Promise<UploadTarget> {
    const { data, error } = await this.db.storage.from(bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`could not sign upload: ${error?.message ?? "unknown"}`);
    return { url: data.signedUrl, method: "PUT", headers: { "content-type": contentType }, token: data.token, expires_at: new Date(this.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  async stat(bucket: string, key: string): Promise<StorageStat | null> {
    const folder = key.split("/").slice(0, -1).join("/");
    const name = key.split("/").pop() ?? "";
    const { data } = await this.db.storage.from(bucket).list(folder, { search: name });
    const file = data?.find((f) => f.name === name);
    if (!file) return null;
    const meta = (file.metadata ?? null) as { size?: number; mimetype?: string } | null;
    return { bytes: meta?.size ?? null, contentType: meta?.mimetype ?? null };
  }

  async delete(bucket: string, key: string): Promise<void> {
    // A missing object is not an error (remove() just returns an empty list).
    const { error } = await this.db.storage.from(bucket).remove([key]);
    if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }
}
