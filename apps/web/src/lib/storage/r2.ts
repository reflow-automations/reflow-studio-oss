import { AwsClient } from "aws4fetch";
import { READ_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS, type StorageBackend, type StorageStat, type UploadTarget } from "@/lib/storage/types";

/**
 * Cloudflare R2 through the S3 API, signed with aws4fetch (fetch + Web Crypto,
 * so it runs in Node and Edge runtimes alike).
 *
 * Objects are read through `publicUrl` when the bucket (or a custom domain) is
 * public — the cheapest option, no signing — otherwise through presigned GET
 * URLs that expire after `READ_URL_TTL_SECONDS`.
 */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL (r2.dev subdomain or custom domain) without trailing slash; optional. */
  publicUrl?: string;
}

export function r2ConfigFromEnv(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (RESERVED_BUCKET_NAMES.has(bucket)) throw new Error(`R2_BUCKET "${bucket}" collides with the Supabase Storage bucket names; pick another bucket name`);
  const publicUrl = env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

/** Supabase Storage bucket ids recorded in `media_assets.bucket`; an R2 bucket with the same name would be ambiguous on read. */
const RESERVED_BUCKET_NAMES = new Set(["media", "uploads"]);

type FetchLike = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export interface R2BackendOptions {
  fetch?: FetchLike;
  now?: () => Date;
}

export class R2StorageBackend implements StorageBackend {
  readonly kind = "r2" as const;
  readonly buckets: { media: string; uploads: string };
  private readonly client: AwsClient;
  private readonly cfg: R2Config;
  private readonly now: () => Date;

  constructor(cfg: R2Config, options: R2BackendOptions = {}) {
    this.cfg = cfg;
    this.buckets = { media: cfg.bucket, uploads: cfg.bucket };
    this.now = options.now ?? (() => new Date());
    this.client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, service: "s3", region: "auto" });
    if (options.fetch) {
      // aws4fetch calls the global fetch; route through the injected one (tests).
      const f = options.fetch;
      this.client.fetch = async (input, init) => f(await this.client.sign(input as Request | string, init));
    }
  }

  owns(bucket: string): boolean {
    return bucket === this.cfg.bucket;
  }

  get publicUrl(): string | undefined {
    return this.cfg.publicUrl;
  }

  get bucket(): string {
    return this.cfg.bucket;
  }

  get endpoint(): string {
    return `https://${this.cfg.accountId}.r2.cloudflarestorage.com`;
  }

  private objectUrl(bucket: string, key: string): string {
    return `${this.endpoint}/${bucket}/${encodeKey(key)}`;
  }

  async put(bucket: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    // R2 requires Content-Length (411 otherwise), so always send materialised bytes.
    const res = await this.client.fetch(this.objectUrl(bucket, key), {
      method: "PUT",
      // Keys are unique per asset and never rewritten, so clients and the CDN may cache forever.
      headers: { "content-type": contentType, "content-length": String(bytes.byteLength), "cache-control": "public, max-age=31536000, immutable" },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`R2 upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }

  async readUrl(bucket: string, key: string): Promise<string | null> {
    if (this.cfg.publicUrl && bucket === this.cfg.bucket) return `${this.cfg.publicUrl}/${encodeKey(key)}`;
    return this.presign("GET", bucket, key, READ_URL_TTL_SECONDS);
  }

  async createUploadTarget(bucket: string, key: string, contentType: string): Promise<UploadTarget> {
    const url = await this.presign("PUT", bucket, key, UPLOAD_URL_TTL_SECONDS);
    return { url, method: "PUT", headers: { "content-type": contentType }, expires_at: new Date(this.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  async stat(bucket: string, key: string): Promise<StorageStat | null> {
    const res = await this.client.fetch(this.objectUrl(bucket, key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 HEAD failed (${res.status})`);
    const length = res.headers.get("content-length");
    return { bytes: length ? Number(length) : null, contentType: res.headers.get("content-type") };
  }

  async delete(bucket: string, key: string): Promise<void> {
    const res = await this.client.fetch(this.objectUrl(bucket, key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
  }

  /** Presigned URL (query-string signature, UNSIGNED-PAYLOAD) valid for `expiresSeconds`. */
  async presign(method: "GET" | "PUT", bucket: string, key: string, expiresSeconds: number): Promise<string> {
    const url = new URL(this.objectUrl(bucket, key));
    url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
    const signed = await this.client.sign(url.toString(), { method, aws: { signQuery: true } });
    return signed.url;
  }

  /** Add our CORS rule (browser GET/HEAD/PUT from `origins`, `<ID>reflow-studio</ID>`), keeping every other rule on a possibly shared bucket; never writes after a failed read. Needs an R2 token with Admin Read & Write. */
  async setCors(origins: string[]): Promise<{ kept: number }> {
    const url = `${this.endpoint}/${this.cfg.bucket}?cors`;
    const readFailure = (reason: string, status?: number) =>
      new Error(`Could not read the existing CORS rules of R2 bucket "${this.cfg.bucket}" (${reason}), so nothing was changed. ${manualCorsInstructions(this.cfg.bucket, origins, status)}`);

    let existing: string[] = [];
    let current: Response;
    try {
      current = await this.client.fetch(url, { method: "GET" });
    } catch (err) {
      throw readFailure(err instanceof Error ? err.message : String(err));
    }
    if (current.ok) {
      const text = await current.text().catch(() => null);
      if (text === null) throw readFailure("response body unreadable");
      try {
        existing = extractCorsRules(text);
      } catch (err) {
        throw readFailure(err instanceof Error ? err.message : String(err));
      }
    } else if (current.status !== 404) {
      // 404 is NoSuchCORSConfiguration (no rules yet); anything else is a failed read.
      throw readFailure(`HTTP ${current.status}${await responseDetail(current)}`, current.status);
    }

    const wanted = new Set(origins);
    const kept = existing.filter((rule) => !isOurCorsRule(rule, wanted));
    const ourRule =
      `<CORSRule><ID>${CORS_RULE_ID}</ID>${origins.map((o) => `<AllowedOrigin>${escapeXml(o)}</AllowedOrigin>`).join("")}` +
      `${CORS_METHODS.map((m) => `<AllowedMethod>${m}</AllowedMethod>`).join("")}<AllowedHeader>*</AllowedHeader>` +
      `${CORS_EXPOSE_HEADERS.map((h) => `<ExposeHeader>${h}</ExposeHeader>`).join("")}<MaxAgeSeconds>${CORS_MAX_AGE_SECONDS}</MaxAgeSeconds></CORSRule>`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration>${kept.join("")}${ourRule}</CORSConfiguration>`;
    const bytes = new TextEncoder().encode(xml);
    let res: Response;
    try {
      res = await this.client.fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/xml", "content-length": String(bytes.byteLength) },
        body: bytes as unknown as BodyInit,
      });
    } catch (err) {
      throw new Error(`R2 CORS update failed (${err instanceof Error ? err.message : String(err)}). ${manualCorsInstructions(this.cfg.bucket, origins)}`);
    }
    if (!res.ok) throw new Error(`R2 CORS update failed (HTTP ${res.status}${await responseDetail(res)}), so nothing was changed. ${manualCorsInstructions(this.cfg.bucket, origins, res.status)}`);
    return { kept: kept.length };
  }

  /** Cheap connectivity/credential check: list zero objects. */
  async probe(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await this.client.fetch(`${this.endpoint}/${this.cfg.bucket}?list-type=2&max-keys=0`, { method: "GET" });
      if (res.ok) return { ok: true };
      return { ok: false, error: `HTTP ${res.status}${res.status === 403 ? " (credentials rejected)" : res.status === 404 ? " (bucket not found)" : ""}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Keys are path-like; encode each segment so odd characters cannot break the signature. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|apos|quot);/gi, (entity: string, name: string) => {
    if (!name.startsWith("#")) return XML_ENTITIES[name.toLowerCase()] ?? entity;
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** Trimmed, unescaped text of every `<tag>` element in an XML fragment. */
function xmlValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, "g");
  const values: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) values.push(unescapeXml((m[1] ?? "").trim()));
  return values;
}

/** Our rule on the bucket. Presigned browser uploads send Content-Type (not CORS-safelisted for image/png etc.), so every request header is allowed. */
const CORS_RULE_ID = "reflow-studio";
const CORS_METHODS = ["GET", "HEAD", "PUT"];
const CORS_EXPOSE_HEADERS = ["Content-Length", "Content-Type", "ETag"];
const CORS_MAX_AGE_SECONDS = 86400;

/** Ours (replaced, not kept) when tagged with our ID; an untagged rule (written before the ID existed) only when it grants nothing beyond ours. */
function isOurCorsRule(rule: string, origins: Set<string>): boolean {
  const ids = xmlValues(rule, "ID");
  if (ids.length > 0) return ids.length === 1 && ids[0] === CORS_RULE_ID;
  const ruleOrigins = xmlValues(rule, "AllowedOrigin");
  const methods = xmlValues(rule, "AllowedMethod").map((m) => m.toUpperCase());
  const ourExposed = new Set(CORS_EXPOSE_HEADERS.map((h) => h.toLowerCase()));
  return (
    ruleOrigins.length > 0 &&
    ruleOrigins.every((o) => origins.has(o)) &&
    methods.includes("PUT") &&
    methods.every((m) => CORS_METHODS.includes(m)) &&
    xmlValues(rule, "ExposeHeader").every((h) => ourExposed.has(h.toLowerCase()))
  );
}

/** How to add our rule by hand in the Cloudflare dashboard, as the JSON its CORS Policy editor accepts. */
function manualCorsInstructions(bucket: string, origins: string[], status?: number): string {
  const policy = JSON.stringify([{ AllowedOrigins: origins, AllowedMethods: CORS_METHODS, AllowedHeaders: ["*"], ExposeHeaders: CORS_EXPOSE_HEADERS, MaxAgeSeconds: CORS_MAX_AGE_SECONDS }]);
  const token = status === 403 ? "The R2 API token may not read or edit bucket settings: Apply CORS needs a token with Admin Read & Write (Object Read & Write only covers objects). " : "";
  return `${token}Add the rule by hand in Cloudflare (R2 → ${bucket} → Settings → CORS Policy, JSON tab): with no policy yet paste ${policy}; otherwise add the object between the brackets next to the existing rules instead of replacing them.`;
}

async function responseDetail(res: Response): Promise<string> {
  const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
  return detail ? `: ${detail}` : "";
}

const CORS_RULE_BLOCK = /<CORSRule(?:\s[^>]*)?>[\s\S]*?<\/CORSRule\s*>/g;

/** Raw `<CORSRule>` blocks of a GetBucketCors response, verbatim; throws on anything it cannot account for so no rule is dropped unseen. */
export function extractCorsRules(xml: string): string[] {
  const body = xml.replace(/^\uFEFF/, "").replace(/^\s*<\?xml[\s\S]*?\?>/, "").trim();
  if (!body) throw new Error("empty response");
  const root = /^<CORSConfiguration(?:\s[^>]*?)?(\/)?>/.exec(body);
  if (!root) throw new Error("unexpected response, not a CORSConfiguration document");
  if (root[1]) {
    if (body.length !== root[0].length) throw new Error("unexpected content after the CORSConfiguration document");
    return [];
  }
  const close = /<\/CORSConfiguration\s*>$/.exec(body);
  if (!close) throw new Error("truncated response, CORSConfiguration is not closed");
  const inner = body.slice(root[0].length, close.index);
  const rules = inner.match(CORS_RULE_BLOCK) ?? [];
  const opened = inner.match(/<(?:[\w.-]+:)?CORSRule[\s/>]/g)?.length ?? 0;
  if (opened !== rules.length || inner.replace(CORS_RULE_BLOCK, "").trim()) throw new Error("could not parse every CORSRule in the response");
  return rules;
}
