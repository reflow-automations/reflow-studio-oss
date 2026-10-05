import { api, ApiError, type MediaResult } from "@/lib/client/api";

/** Upload a browser File: create a signed target, PUT the bytes, confirm. */
export async function uploadFile(file: File, onProgress?: (fraction: number) => void): Promise<MediaResult> {
  const contentType = file.type || "application/octet-stream";
  const target = await api.media.createUploadTarget({ filename: file.name, content_type: contentType });
  onProgress?.(0.1);
  const put = await fetch(target.upload_url, { method: target.method, headers: target.headers, body: file });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    throw new ApiError(put.status, { code: "upload_failed", message: text || `upload failed (${put.status})` });
  }
  onProgress?.(0.8);
  const confirmed = await api.media.confirm(target.asset_id);
  onProgress?.(1);
  return confirmed;
}

/** Import a public https URL as a media asset. */
export async function importUrl(url: string, type?: "image" | "video" | "audio"): Promise<MediaResult> {
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) throw new ApiError(400, { code: "invalid_request", message: "Only https:// URLs can be imported" });
  return api.media.importUrl({ url: trimmed, type });
}

export function acceptFor(kind: string): string {
  switch (kind) {
    case "image":
      return "image/*";
    case "video":
      return "video/*";
    case "audio":
      return "audio/*";
    default:
      return "*/*";
  }
}
