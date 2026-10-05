import { base64ToBytes, bytesToBase64, utf8 } from "./crypto";

/** Build a base64 `data:` URL from bytes or a UTF-8 string. */
export function toDataUrl(contentType: string, content: Uint8Array | string): string {
  const bytes = typeof content === "string" ? utf8(content) : content;
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

export interface DecodedDataUrl {
  contentType: string;
  bytes: Uint8Array;
}

// [\s\S] instead of the `s` flag: consumers may compile for targets before ES2018.
const DATA_URL_RE = /^data:([^,]*?),([\s\S]*)$/;

/**
 * Decode a `data:` URL (base64 or percent-encoded). Returns undefined for
 * anything that is not a well-formed data URL. Hosts use this to store mock
 * outputs (and fal `sync_mode` results) without a network fetch.
 */
export function decodeDataUrl(url: string, options: { maxBytes?: number } = {}): DecodedDataUrl | undefined {
  const match = DATA_URL_RE.exec(url);
  if (!match) return undefined;
  const meta = (match[1] ?? "").split(";").map((part) => part.trim());
  const base64 = meta.includes("base64");
  const contentType = meta[0] && meta[0].includes("/") ? meta[0].toLowerCase() : "text/plain";
  const payload = match[2] ?? "";
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  // base64 grows 4/3; reject early before allocating.
  if ((base64 ? (payload.length * 3) / 4 : payload.length) > maxBytes * 1.01 + 4) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64 ? base64ToBytes(payload.replace(/\s+/g, "")) : utf8(decodeURIComponent(payload));
  } catch {
    return undefined;
  }
  if (bytes.byteLength > maxBytes) return undefined;
  return { contentType, bytes };
}
