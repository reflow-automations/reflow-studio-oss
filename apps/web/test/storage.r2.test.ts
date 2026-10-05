import { describe, expect, it } from "vitest";
import { R2StorageBackend, extractCorsRules, r2ConfigFromEnv } from "@/lib/storage/r2";
import { objectKey } from "@/lib/storage/types";

const CFG = { accountId: "acct123", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret-example", bucket: "studio-media" };

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

function recorder(respond: (req: Recorded) => Response = () => new Response(null, { status: 200 })) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => void (headers[k] = v));
    const buf = request.method === "GET" || request.method === "HEAD" ? null : new Uint8Array(await request.arrayBuffer());
    const call = { url: request.url, method: request.method, headers, body: buf };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch: fetchImpl };
}

describe("r2ConfigFromEnv", () => {
  it("requires all four credentials and trims the public url", () => {
    expect(r2ConfigFromEnv({})).toBeNull();
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" })).toBeNull();
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PUBLIC_URL: "https://pub.example.com/ " })).toEqual({ accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d", publicUrl: "https://pub.example.com" });
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PUBLIC_URL: "" })?.publicUrl).toBeUndefined();
  });

  it("refuses bucket names that collide with the Supabase buckets", () => {
    expect(() => r2ConfigFromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "media" })).toThrow(/collides/);
  });
});

describe("objectKey", () => {
  it("lays keys out as workspace/yyyy/mm/id.ext", () => {
    expect(objectKey("ws-1", "asset-9", "png", new Date("2026-03-07T12:00:00Z"))).toBe("ws-1/2026/03/asset-9.png");
  });
});

describe("R2StorageBackend", () => {
  it("PUTs bytes with a SigV4 header signature and an explicit Content-Length", async () => {
    const rec = recorder();
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await r2.put("studio-media", "ws/2026/09/a.png", bytes, "image/png");
    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0]!;
    expect(call.method).toBe("PUT");
    expect(call.url).toBe("https://acct123.r2.cloudflarestorage.com/studio-media/ws/2026/09/a.png");
    expect(call.headers["content-type"]).toBe("image/png");
    expect(call.headers["content-length"]).toBe("4");
    expect(call.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/);
    // aws4fetch signs S3 requests with UNSIGNED-PAYLOAD (Content-Length still guards the body).
    expect(call.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(call.body).toEqual(bytes);
  });

  it("surfaces upload failures with the status code", async () => {
    const rec = recorder(() => new Response("AccessDenied", { status: 403 }));
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    await expect(r2.put("studio-media", "k", new Uint8Array([1]), "image/png")).rejects.toThrow(/R2 upload failed \(403\): AccessDenied/);
  });

  it("uses the public url for reads when configured and presigned urls otherwise", async () => {
    const pub = new R2StorageBackend({ ...CFG, publicUrl: "https://media.example.com" }, { fetch: recorder().fetch });
    expect(await pub.readUrl("studio-media", "ws/2026/09/a b.png")).toBe("https://media.example.com/ws/2026/09/a%20b.png");
    expect(pub.owns("studio-media")).toBe(true);
    expect(pub.owns("media")).toBe(false);

    const priv = new R2StorageBackend(CFG, { fetch: recorder().fetch, now: () => new Date("2026-09-05T10:00:00Z") });
    const url = new URL((await priv.readUrl("studio-media", "ws/2026/09/a.png"))!);
    expect(url.origin + url.pathname).toBe("https://acct123.r2.cloudflarestorage.com/studio-media/ws/2026/09/a.png");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("21600");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKIAEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("presigns PUT upload targets for one hour", async () => {
    const r2 = new R2StorageBackend(CFG, { fetch: recorder().fetch, now: () => new Date("2026-09-05T10:00:00Z") });
    const target = await r2.createUploadTarget("studio-media", "ws/2026/09/u.mp4", "video/mp4");
    expect(target.method).toBe("PUT");
    expect(target.headers).toEqual({ "content-type": "video/mp4" });
    expect(target.token).toBeUndefined();
    expect(target.expires_at).toBe("2026-09-05T11:00:00.000Z");
    const url = new URL(target.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stats objects with HEAD and treats 404 as missing", async () => {
    const rec = recorder((req) => (req.url.endsWith("/missing.png") ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { "content-length": "1234", "content-type": "image/png" } })));
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    expect(await r2.stat("studio-media", "ws/2026/09/present.png")).toEqual({ bytes: 1234, contentType: "image/png" });
    expect(await r2.stat("studio-media", "ws/2026/09/missing.png")).toBeNull();
    expect(rec.calls.map((c) => c.method)).toEqual(["HEAD", "HEAD"]);
  });

  it("probes credentials with an empty listing", async () => {
    const ok = new R2StorageBackend(CFG, { fetch: recorder().fetch });
    expect(await ok.probe()).toEqual({ ok: true });
    const denied = new R2StorageBackend(CFG, { fetch: recorder(() => new Response(null, { status: 403 })).fetch });
    expect(await denied.probe()).toEqual({ ok: false, error: "HTTP 403 (credentials rejected)" });
  });
});

describe("R2StorageBackend.setCors", () => {
  const CORS_URL = "https://acct123.r2.cloudflarestorage.com/studio-media?cors";
  const ORIGINS = ["https://studio.example.com", "http://localhost:3000"];
  const NO_CORS = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchCORSConfiguration</Code><Message>The CORS configuration does not exist</Message></Error>`;
  // A rule another app put on the shared bucket, in the whitespace-heavy shape S3 returns.
  const FOREIGN_RULE = `<CORSRule>
    <AllowedOrigin>https://canvas.example.com</AllowedOrigin>
    <AllowedOrigin>http://localhost:5173</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>`;

  const rulesIn = (xml: string) => xml.match(/<CORSRule>[\s\S]*?<\/CORSRule>/g) ?? [];

  /** The error spells out the complete rule, including AllowedHeaders, as the JSON Cloudflare's CORS Policy editor accepts. */
  function expectManualRule(message: string | undefined) {
    expect(message).toContain("AllowedHeaders");
    const json = /(\[\{.*?\}\])/.exec(message ?? "")?.[1];
    expect(JSON.parse(json ?? "null")).toEqual([
      { AllowedOrigins: ORIGINS, AllowedMethods: ["GET", "HEAD", "PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["Content-Length", "Content-Type", "ETag"], MaxAgeSeconds: 86400 },
    ]);
  }

  /** In-memory bucket CORS config: GET returns it (404 when unset), PUT replaces it. */
  function bucket(initial: string | null) {
    let config = initial;
    const rec = recorder((req) => {
      if (req.url !== CORS_URL) return new Response(null, { status: 500 });
      if (req.method === "GET") return config === null ? new Response(NO_CORS, { status: 404, headers: { "content-type": "application/xml" } }) : new Response(config, { status: 200, headers: { "content-type": "application/xml" } });
      if (req.method === "PUT") {
        config = new TextDecoder().decode(req.body!);
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 405 });
    });
    return { rec, config: () => config };
  }

  it("writes a single rule when the bucket has no CORS configuration (404)", async () => {
    const { rec, config } = bucket(null);
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    expect(await r2.setCors(ORIGINS)).toEqual({ kept: 0 });
    expect(rec.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${CORS_URL}`, `PUT ${CORS_URL}`]);
    expect(rec.calls[0]!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    const put = rec.calls[1]!;
    expect(put.headers["content-type"]).toBe("application/xml");
    expect(put.headers["content-length"]).toBe(String(put.body!.byteLength));
    const xml = config()!;
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><CORSConfiguration><CORSRule>/);
    const rules = rulesIn(xml);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain("<AllowedOrigin>https://studio.example.com</AllowedOrigin><AllowedOrigin>http://localhost:3000</AllowedOrigin>");
    expect(rules[0]).toContain("<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod>");
    expect(rules[0]).toContain("<AllowedHeader>*</AllowedHeader>");
    expect(rules[0]).toContain("<ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Type</ExposeHeader><ExposeHeader>ETag</ExposeHeader>");
    expect(rules[0]).toContain("<MaxAgeSeconds>86400</MaxAgeSeconds>");
    expect(rules[0]).toMatch(/^<CORSRule><ID>reflow-studio<\/ID>/);
  });

  it("keeps an existing foreign rule verbatim next to ours", async () => {
    const { rec, config } = bucket(`<?xml version="1.0" encoding="UTF-8"?>\n<CORSConfiguration>\n  ${FOREIGN_RULE}\n</CORSConfiguration>`);
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    expect(await r2.setCors(ORIGINS)).toEqual({ kept: 1 });
    const xml = config()!;
    expect(xml).toContain(FOREIGN_RULE);
    const rules = rulesIn(xml);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toBe(FOREIGN_RULE);
    expect(rules[1]).toContain("<AllowedOrigin>https://studio.example.com</AllowedOrigin>");
  });

  it("is idempotent: re-applying replaces our rule instead of duplicating it", async () => {
    const { rec, config } = bucket(`<CORSConfiguration>${FOREIGN_RULE}</CORSConfiguration>`);
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    await r2.setCors(ORIGINS);
    const first = config();
    expect(await r2.setCors(ORIGINS)).toEqual({ kept: 1 });
    expect(config()).toBe(first);
    expect(rulesIn(config()!)).toHaveLength(2);
    expect(rec.calls.map((c) => c.method)).toEqual(["GET", "PUT", "GET", "PUT"]);
  });

  it("replaces an earlier rule of ours whose origins are a subset of the new ones", async () => {
    const earlier = `<CORSRule><AllowedOrigin>https://studio.example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod></CORSRule>`;
    const localGet = `<CORSRule><AllowedOrigin>http://localhost:3000</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule>`;
    const { rec, config } = bucket(`<CORSConfiguration>${earlier}${localGet}</CORSConfiguration>`);
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    // The PUT-less localhost rule cannot have been written by us, so it stays.
    expect(await r2.setCors(ORIGINS)).toEqual({ kept: 1 });
    const rules = rulesIn(config()!);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toBe(localGet);
    expect(config()).not.toContain(earlier);
  });

  it("parses a namespaced, indented response and treats an empty configuration as no rules", async () => {
    const ours = `<CORSRule><AllowedOrigin>https://studio.example.com</AllowedOrigin><AllowedOrigin>http://localhost:3000</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod></CORSRule>`;
    const namespaced = `<?xml version="1.0" encoding="UTF-8"?>\n<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  ${FOREIGN_RULE}\n  ${ours}\n</CORSConfiguration>\n`;
    const a = bucket(namespaced);
    expect(await new R2StorageBackend(CFG, { fetch: a.rec.fetch }).setCors(ORIGINS)).toEqual({ kept: 1 });
    expect(rulesIn(a.config()!)).toEqual([FOREIGN_RULE, expect.stringContaining("<MaxAgeSeconds>86400</MaxAgeSeconds>")]);

    for (const empty of ["<CORSConfiguration/>", `<?xml version="1.0" encoding="UTF-8"?>\n<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />`, "<CORSConfiguration></CORSConfiguration>"]) {
      const b = bucket(empty);
      expect(await new R2StorageBackend(CFG, { fetch: b.rec.fetch }).setCors(ORIGINS)).toEqual({ kept: 0 });
      expect(rulesIn(b.config()!)).toHaveLength(1);
    }
  });

  it("throws and does not PUT when the existing rules cannot be read (403)", async () => {
    const rec = recorder((req) => (req.method === "GET" ? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) : new Response(null, { status: 200 })));
    const r2 = new R2StorageBackend(CFG, { fetch: rec.fetch });
    const error = await r2.setCors(ORIGINS).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(error?.message).toMatch(/Could not read the existing CORS rules .*HTTP 403.*AccessDenied.*nothing was changed/);
    expect(error?.message).toContain("Settings → CORS Policy");
    expect(error?.message).toContain("Admin Read & Write");
    expectManualRule(error?.message);
    expect(rec.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("gives the manual rule when the token can read the rules but not write them (PUT 403)", async () => {
    const denied = recorder((req) => (req.method === "PUT" ? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 }) : new Response(NO_CORS, { status: 404 })));
    const error = await new R2StorageBackend(CFG, { fetch: denied.fetch }).setCors(ORIGINS).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(error?.message).toMatch(/R2 CORS update failed \(HTTP 403: .*AccessDenied.*\), so nothing was changed/);
    expect(error?.message).toContain("Admin Read & Write");
    expectManualRule(error?.message);
    expect(denied.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
  });

  it("keeps a foreign rule on one of our origins that grants more than ours", async () => {
    const wider = `<CORSRule><AllowedOrigin>http://localhost:3000</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedMethod>DELETE</AllowedMethod><AllowedHeader>*</AllowedHeader></CORSRule>`;
    const exposes = `<CORSRule><AllowedOrigin>http://localhost:3000</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><ExposeHeader>x-amz-version-id</ExposeHeader></CORSRule>`;
    const named = `<CORSRule><ID>canvas-dev</ID><AllowedOrigin>https://studio.example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod></CORSRule>`;
    const { rec, config } = bucket(`<CORSConfiguration>${wider}${exposes}${named}</CORSConfiguration>`);
    expect(await new R2StorageBackend(CFG, { fetch: rec.fetch }).setCors(ORIGINS)).toEqual({ kept: 3 });
    expect(rulesIn(config()!)).toEqual([wider, exposes, named, expect.stringContaining("<ID>reflow-studio</ID>")]);
  });

  it("replaces a rule tagged with our ID even when its origins changed", async () => {
    const old = `<CORSRule><ID>reflow-studio</ID><AllowedOrigin>https://old.example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod></CORSRule>`;
    const { rec, config } = bucket(`<CORSConfiguration>${FOREIGN_RULE}${old}</CORSConfiguration>`);
    expect(await new R2StorageBackend(CFG, { fetch: rec.fetch }).setCors(ORIGINS)).toEqual({ kept: 1 });
    expect(config()).not.toContain("old.example.com");
    expect(rulesIn(config()!)).toHaveLength(2);
  });

  it("throws and does not PUT when the response is not a CORS configuration", async () => {
    const rule = "<CORSRule><AllowedOrigin>a</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule>";
    const bodies = [
      "",
      "<html><body>Bad gateway</body></html>",
      "<CORSConfiguration><s3:CORSRule><AllowedOrigin>x</AllowedOrigin></s3:CORSRule></CORSConfiguration>",
      `<CORSConfiguration>${rule}<CORS`,
      `<CORSConfiguration>${rule}`,
      `<CORSConfiguration><Foo>bar</Foo>${rule}</CORSConfiguration>`,
      "<CORSConfiguration/><CORSRule></CORSRule>",
    ];
    for (const body of bodies) {
      const rec = recorder((req) => (req.method === "GET" ? new Response(body, { status: 200 }) : new Response(null, { status: 200 })));
      await expect(new R2StorageBackend(CFG, { fetch: rec.fetch }).setCors(ORIGINS)).rejects.toThrow(/nothing was changed/);
      expect(rec.calls.map((c) => c.method)).toEqual(["GET"]);
    }
  });

  it("throws and does not PUT when the read itself fails", async () => {
    const rec = recorder((req) => {
      if (req.method === "GET") throw new TypeError("fetch failed");
      return new Response(null, { status: 200 });
    });
    await expect(new R2StorageBackend(CFG, { fetch: rec.fetch }).setCors(ORIGINS)).rejects.toThrow(/Could not read the existing CORS rules .*fetch failed.*nothing was changed/);
    expect(rec.calls.map((c) => c.method)).toEqual(["GET"]);
  });
});

describe("extractCorsRules", () => {
  const rule = "<CORSRule><AllowedOrigin>a</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule>";

  it("returns every rule of a complete document", () => {
    expect(extractCorsRules(`<?xml version="1.0"?>\n<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  ${rule}\n  ${rule}\n</CORSConfiguration>\n`)).toEqual([rule, rule]);
    expect(extractCorsRules("<CORSConfiguration />")).toEqual([]);
  });

  it("throws on a truncated body instead of dropping the rules after the cut", () => {
    expect(() => extractCorsRules(`<CORSConfiguration>${rule}<CORS`)).toThrow(/not closed/);
    expect(() => extractCorsRules(`<CORSConfiguration>${rule}`)).toThrow(/not closed/);
    expect(() => extractCorsRules(`<CORSConfiguration>${rule}<CORSRule><AllowedOrigin>b</AllowedOrigin></CORSConfiguration>`)).toThrow(/every CORSRule/);
  });

  it("throws on elements it does not know instead of skipping them", () => {
    expect(() => extractCorsRules(`<CORSConfiguration><Foo>bar</Foo>${rule}</CORSConfiguration>`)).toThrow(/every CORSRule/);
    expect(() => extractCorsRules(`<CORSConfiguration>${rule}<!-- note --></CORSConfiguration>`)).toThrow(/every CORSRule/);
    expect(() => extractCorsRules("<CORSConfiguration/><CORSRule></CORSRule>")).toThrow(/after the CORSConfiguration/);
  });
});
