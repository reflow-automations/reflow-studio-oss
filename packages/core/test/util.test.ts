import { describe, expect, it } from "vitest";
import { getFirst, getPath, setPath } from "../src/util/path";
import { dimensionsFor, megapixels, nearestAspectRatio, parseAspectRatio } from "../src/util/aspect";
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  hexToBytes,
  hmacSha256,
  randomToken,
  sha256Hex,
  timingSafeEqual,
  utf8,
} from "../src/util/crypto";
import { header, requestJson } from "../src/util/http";
import { ambiguousSubmit, isAmbiguousSubmission, isAmbiguousSubmitStatus, isSafeToFallBack, isStudioError, rejectedSubmit, StudioError, withSubmissionOutcome, type StudioErrorCode } from "../src/util/errors";
import { decodeDataUrl, toDataUrl } from "../src/util/data-url";
import { SlidingWindowLimiter } from "../src/util/rate-limit";
import { createFakeFetch, jsonResponse, rejection, textResponse } from "./_helpers";

describe("util/path", () => {
  const payload = {
    images: [{ url: "https://a" }, { url: "https://b" }, { nope: true }],
    video: { url: "https://v" },
    data: { resultUrls: ["https://r1", "https://r2"], empty: [], scalar: "x" },
    nil: null,
  };

  describe("getPath", () => {
    it("iterates arrays with [] and picks nested keys", () => {
      expect(getPath(payload, "images[].url")).toEqual(["https://a", "https://b"]);
      expect(getPath(payload, "data.resultUrls[]")).toEqual(["https://r1", "https://r2"]);
    });

    it("resolves plain nested paths to a single-element array", () => {
      expect(getPath(payload, "video.url")).toEqual(["https://v"]);
      expect(getPath(payload, "video")).toEqual([{ url: "https://v" }]);
    });

    it("returns [] for missing keys, null values, and non-object intermediates", () => {
      expect(getPath(payload, "missing")).toEqual([]);
      expect(getPath(payload, "video.missing.deeper")).toEqual([]);
      expect(getPath(payload, "nil")).toEqual([]);
      expect(getPath(payload, "nil.url")).toEqual([]);
      expect(getPath(payload, "data.scalar.length")).toEqual([]);
      expect(getPath(null, "a")).toEqual([]);
      expect(getPath(42, "a")).toEqual([]);
    });

    it("[] on a non-array or empty array yields nothing", () => {
      expect(getPath(payload, "data.scalar[]")).toEqual([]);
      expect(getPath(payload, "data.empty[]")).toEqual([]);
      expect(getPath(payload, "video[]")).toEqual([]);
    });

    it("empty path or $ returns the input itself (unless undefined)", () => {
      expect(getPath(payload, "")).toEqual([payload]);
      expect(getPath(payload, "$")).toEqual([payload]);
      expect(getPath(undefined, "")).toEqual([]);
    });

    it("a bare [] iterates the root array", () => {
      expect(getPath(["a", "b"], "[]")).toEqual(["a", "b"]);
      expect(getPath([{ url: "u" }], "[].url")).toEqual(["u"]);
    });
  });

  describe("getFirst", () => {
    it("returns the first match or undefined", () => {
      expect(getFirst(payload, "images[].url")).toBe("https://a");
      expect(getFirst<string>(payload, "video.url")).toBe("https://v");
      expect(getFirst(payload, "nowhere")).toBeUndefined();
    });
  });

  describe("setPath", () => {
    it("sets top-level and nested keys, creating intermediate objects", () => {
      const target: Record<string, unknown> = {};
      setPath(target, "prompt", "hi");
      setPath(target, "input.image.url", "https://x");
      expect(target).toEqual({ prompt: "hi", input: { image: { url: "https://x" } } });
    });

    it("keeps existing intermediate objects and overwrites leaves", () => {
      const target: Record<string, unknown> = { input: { keep: 1, url: "old" } };
      setPath(target, "input.url", "new");
      expect(target).toEqual({ input: { keep: 1, url: "new" } });
    });

    it("replaces non-object intermediates (scalars, null, arrays) with objects", () => {
      const scalar: Record<string, unknown> = { a: 5 };
      setPath(scalar, "a.b", 1);
      expect(scalar).toEqual({ a: { b: 1 } });

      const nil: Record<string, unknown> = { a: null };
      setPath(nil, "a.b", 1);
      expect(nil).toEqual({ a: { b: 1 } });

      const arr: Record<string, unknown> = { a: [1, 2] };
      setPath(arr, "a.b", 1);
      expect(arr).toEqual({ a: { b: 1 } });
    });

    it("appends with a trailing [] instead of overwriting", () => {
      const target: Record<string, unknown> = {};
      setPath(target, "urls[]", "one");
      setPath(target, "urls[]", "two");
      expect(target).toEqual({ urls: ["one", "two"] });
    });

    it("appending an array spreads its items; appending onto a non-array starts fresh", () => {
      const target: Record<string, unknown> = { list: [0], notArray: "x" };
      setPath(target, "list[]", [1, 2]);
      setPath(target, "notArray[]", "y");
      setPath(target, "nested.items[]", "z");
      expect(target).toEqual({ list: [0, 1, 2], notArray: ["y"], nested: { items: ["z"] } });
    });

    it("can set undefined and null values explicitly", () => {
      const target: Record<string, unknown> = {};
      setPath(target, "a", null);
      setPath(target, "b", undefined);
      expect(target).toEqual({ a: null, b: undefined });
      expect("b" in target).toBe(true);
    });
  });
});

describe("util/aspect", () => {
  describe("parseAspectRatio", () => {
    it("parses W:H into width / height", () => {
      expect(parseAspectRatio("16:9")).toBeCloseTo(16 / 9, 10);
      expect(parseAspectRatio("1:1")).toBe(1);
      expect(parseAspectRatio("9:16")).toBeCloseTo(9 / 16, 10);
      expect(parseAspectRatio("1.5:1")).toBe(1.5);
      expect(parseAspectRatio("  4:3 ")).toBeCloseTo(4 / 3, 10);
    });

    it("returns undefined for auto, empty, invalid, or zero-height input", () => {
      expect(parseAspectRatio(undefined)).toBeUndefined();
      expect(parseAspectRatio("")).toBeUndefined();
      expect(parseAspectRatio("auto")).toBeUndefined();
      expect(parseAspectRatio("16/9")).toBeUndefined();
      expect(parseAspectRatio("16:9:1")).toBeUndefined();
      expect(parseAspectRatio("4:0")).toBeUndefined();
      expect(parseAspectRatio("-4:3")).toBeUndefined();
    });
  });

  describe("nearestAspectRatio", () => {
    const supported = ["1:1", "16:9", "9:16"];

    it("returns an exact match when present", () => {
      expect(nearestAspectRatio("16:9", supported)).toBe("16:9");
    });

    it("picks the closest supported ratio by log distance", () => {
      expect(nearestAspectRatio("21:9", supported)).toBe("16:9");
      expect(nearestAspectRatio("3:2", supported)).toBe("16:9");
      expect(nearestAspectRatio("2:3", supported)).toBe("9:16");
      expect(nearestAspectRatio("5:4", supported)).toBe("1:1");
      expect(nearestAspectRatio("1:100", supported)).toBe("9:16");
    });

    it("is symmetric between landscape and portrait", () => {
      expect(nearestAspectRatio("3:1", ["1:1", "2:1", "1:2"])).toBe("2:1");
      expect(nearestAspectRatio("1:3", ["1:1", "2:1", "1:2"])).toBe("1:2");
    });

    it("skips unparsable candidates and returns undefined when nothing usable", () => {
      expect(nearestAspectRatio("16:9", ["auto", "3:2"])).toBe("3:2");
      expect(nearestAspectRatio("16:9", ["auto"])).toBeUndefined();
      expect(nearestAspectRatio("16:9", [])).toBeUndefined();
      expect(nearestAspectRatio("auto", supported)).toBeUndefined();
    });
  });

  describe("dimensionsFor", () => {
    it("uses the tier as the long side and rounds to multiples of 16", () => {
      expect(dimensionsFor("1:1")).toEqual({ width: 1024, height: 1024 });
      expect(dimensionsFor("1:1", "1k")).toEqual({ width: 1024, height: 1024 });
      expect(dimensionsFor("16:9", "1k")).toEqual({ width: 1024, height: 576 });
      expect(dimensionsFor("9:16", "1k")).toEqual({ width: 576, height: 1024 });
      expect(dimensionsFor("4:3", "1k")).toEqual({ width: 1024, height: 768 });
      expect(dimensionsFor("3:2", "1k")).toEqual({ width: 1024, height: 688 }); // 682.67 -> 688
    });

    it("supports 2k / 4k tiers and explicit numeric long sides", () => {
      expect(dimensionsFor("1:1", "2k")).toEqual({ width: 2048, height: 2048 });
      expect(dimensionsFor("16:9", "4k")).toEqual({ width: 4096, height: 2304 });
      expect(dimensionsFor("1:1", 512)).toEqual({ width: 512, height: 512 });
      expect(dimensionsFor("16:9", 500)).toEqual({ width: 496, height: 288 });
    });

    it("falls back to 1:1 for unparsable ratios and never returns less than 16px", () => {
      expect(dimensionsFor("auto")).toEqual({ width: 1024, height: 1024 });
      expect(dimensionsFor("1:1000", "1k")).toEqual({ width: 16, height: 1024 });
    });
  });

  describe("megapixels", () => {
    it("rounds UP to three decimals", () => {
      expect(megapixels({ width: 1024, height: 1024 })).toBe(1.049); // 1.048576
      expect(megapixels({ width: 1024, height: 576 })).toBe(0.59); // 0.589824
      expect(megapixels({ width: 1000, height: 1000 })).toBe(1);
      expect(megapixels({ width: 16, height: 16 })).toBe(0.001); // 0.000256 -> 0.001
      expect(megapixels({ width: 2048, height: 2048 })).toBe(4.195);
    });
  });
});

describe("util/crypto", () => {
  describe("hex", () => {
    it("round-trips bytes and handles case", () => {
      const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
      const hex = bytesToHex(bytes);
      expect(hex).toBe("00010f107f80ff");
      expect(hexToBytes(hex)).toEqual(bytes);
      expect(hexToBytes("00010F107F80FF")).toEqual(bytes);
      expect(hexToBytes(" 00ff ")).toEqual(new Uint8Array([0, 255]));
      expect(bytesToHex(new Uint8Array())).toBe("");
      expect(hexToBytes("")).toEqual(new Uint8Array());
    });

    it("rejects odd length and non-hex characters", () => {
      expect(() => hexToBytes("abc")).toThrow("invalid hex");
      expect(() => hexToBytes("zz")).toThrow("invalid hex");
      expect(() => hexToBytes("0x00")).toThrow("invalid hex");
    });
  });

  describe("base64 / base64url", () => {
    it("round-trips bytes through standard base64", () => {
      const bytes = new Uint8Array([104, 105, 33]);
      expect(bytesToBase64(bytes)).toBe("aGkh");
      expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
      expect(base64ToBytes("aGk=")).toEqual(new Uint8Array([104, 105]));
      for (const sample of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([251, 255, 254]), new Uint8Array(64).map((_, i) => i * 4)]) {
        expect(base64ToBytes(bytesToBase64(sample))).toEqual(sample);
      }
    });

    it("decodes base64url with URL-safe alphabet and missing padding", () => {
      // [251, 255] -> standard "+/8=" -> url "-_8"
      expect(base64UrlToBytes("-_8")).toEqual(new Uint8Array([251, 255]));
      expect(base64UrlToBytes("aGk")).toEqual(new Uint8Array([104, 105]));
      expect(base64UrlToBytes("aGk=")).toEqual(new Uint8Array([104, 105]));
      expect(base64UrlToBytes("aGkh")).toEqual(new Uint8Array([104, 105, 33]));
      expect(base64UrlToBytes("")).toEqual(new Uint8Array());
    });

    it("rejects malformed base64", () => {
      expect(() => base64ToBytes("not base64!!")).toThrow();
    });
  });

  describe("bytesToBase64Url", () => {
    it("uses the URL-safe alphabet without padding and round-trips", () => {
      const bytes = new Uint8Array([251, 255, 191, 0]);
      expect(bytesToBase64Url(bytes)).toBe("-_-_AA");
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    });
  });

  describe("timingSafeEqual", () => {
    it("compares content and length", () => {
      expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
      expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
      expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
      expect(timingSafeEqual(new Uint8Array([]), new Uint8Array([]))).toBe(true);
      expect(timingSafeEqual(new Uint8Array([0]), new Uint8Array([]))).toBe(false);
    });
  });

  describe("sha256Hex", () => {
    it("matches the FIPS 180 'abc' vector for strings and bytes", async () => {
      const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
      expect(await sha256Hex("abc")).toBe(expected);
      expect(await sha256Hex(utf8("abc"))).toBe(expected);
      expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  });

  describe("hmacSha256", () => {
    it("matches RFC 4231 test case 2", async () => {
      const mac = await hmacSha256("Jefe", "what do ya want for nothing?");
      expect(mac).toBeInstanceOf(Uint8Array);
      expect(mac.length).toBe(32);
      expect(bytesToHex(mac)).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    });

    it("differs when the key or message changes", async () => {
      const base = bytesToHex(await hmacSha256("Jefe", "what do ya want for nothing?"));
      expect(bytesToHex(await hmacSha256("Jefe!", "what do ya want for nothing?"))).not.toBe(base);
      expect(bytesToHex(await hmacSha256("Jefe", "what do ya want for nothing"))).not.toBe(base);
    });
  });

  describe("randomToken", () => {
    it("produces URL-safe tokens of the expected length", () => {
      const token = randomToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).toHaveLength(43); // 32 bytes -> 44 base64 chars minus one '=' pad
      expect(randomToken(16)).toHaveLength(22);
      expect(randomToken()).not.toBe(token);
    });
  });
});

describe("util/http", () => {
  describe("header", () => {
    it("looks headers up case-insensitively", () => {
      const headers = { "Content-Type": "application/json", "x-fal-webhook-signature": "abc" };
      expect(header(headers, "content-type")).toBe("application/json");
      expect(header(headers, "CONTENT-TYPE")).toBe("application/json");
      expect(header(headers, "X-Fal-Webhook-Signature")).toBe("abc");
      expect(header(headers, "missing")).toBeUndefined();
      expect(header({}, "anything")).toBeUndefined();
    });
  });

  describe("requestJson", () => {
    it("GETs by default, sets accept, and parses JSON", async () => {
      const ff = createFakeFetch(() => jsonResponse({ ok: 1 }));
      const res = await requestJson<{ ok: number }>(ff.fetch, "https://x.test/a");
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      expect(res.json).toEqual({ ok: 1 });
      expect(res.text).toBe('{"ok":1}');
      expect(ff.calls[0]?.method).toBe("GET");
      expect(ff.calls[0]?.headers.accept).toBe("application/json");
      expect(ff.calls[0]?.headers["content-type"]).toBeUndefined();
      expect(ff.calls[0]?.body).toBeUndefined();
    });

    it("POSTs JSON when a body is given and merges custom headers", async () => {
      const ff = createFakeFetch(() => jsonResponse({}, 201));
      await requestJson(ff.fetch, "https://x.test/b", { body: { a: 1 }, headers: { authorization: "Key k" } });
      const call = ff.calls[0];
      expect(call?.method).toBe("POST");
      expect(call?.headers["content-type"]).toBe("application/json");
      expect(call?.headers.authorization).toBe("Key k");
      expect(call?.json).toEqual({ a: 1 });
    });

    it("does not throw on HTTP errors and tolerates non-JSON bodies", async () => {
      const ff = createFakeFetch(() => textResponse("Bad Gateway", 502));
      const res = await requestJson(ff.fetch, "https://x.test/c");
      expect(res.ok).toBe(false);
      expect(res.status).toBe(502);
      expect(res.json).toBeUndefined();
      expect(res.text).toBe("Bad Gateway");
    });

    it("aborts after timeoutMs and marks POSTs that may have been accepted as ambiguous", async () => {
      const hanging = (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      const timedOut = await rejection(requestJson(hanging, "https://x.test/slow", { timeoutMs: 5 }));
      expect(timedOut.message).toBe("request to https://x.test/slow timed out");
      expect(timedOut.retryable).toBe(true);
      expect(timedOut.submissionOutcome).toBeUndefined();
      const submit = await rejection(requestJson(hanging, "https://x.test/submit", { method: "POST", body: {}, timeoutMs: 5, ambiguousOnTransportError: true }));
      expect(submit.submissionOutcome).toBe("unknown");
      expect(submit.retryable).toBe(false);
      expect(submit.details).toEqual({ submissionOutcome: "unknown" });
    });

    it("wraps transport failures in a retryable provider_unavailable StudioError", async () => {
      const ff = createFakeFetch(() => {
        throw new Error("ECONNRESET");
      });
      const error = await rejection(requestJson(ff.fetch, "https://x.test/d"));
      expect(error.code).toBe("provider_unavailable");
      expect(error.retryable).toBe(true);
      expect(error.message).toContain("https://x.test/d");
      expect(error.message).toContain("ECONNRESET");
    });
  });
});

describe("util/data-url", () => {
  it("round-trips bytes and strings through base64 data URLs", () => {
    const url = toDataUrl("image/svg+xml", "<svg/>");
    expect(url).toBe("data:image/svg+xml;base64,PHN2Zy8+");
    const decoded = decodeDataUrl(url);
    expect(decoded?.contentType).toBe("image/svg+xml");
    expect(new TextDecoder().decode(decoded?.bytes)).toBe("<svg/>");
    expect(decodeDataUrl(toDataUrl("application/octet-stream", new Uint8Array([0, 255, 7])))?.bytes).toEqual(new Uint8Array([0, 255, 7]));
  });

  it("decodes percent-encoded payloads, defaults the type and enforces the size cap", () => {
    expect(new TextDecoder().decode(decodeDataUrl("data:,Hello%2C%20World")?.bytes)).toBe("Hello, World");
    expect(decodeDataUrl("data:,x")?.contentType).toBe("text/plain");
    expect(decodeDataUrl(toDataUrl("text/plain", "x".repeat(100)), { maxBytes: 10 })).toBeUndefined();
    expect(decodeDataUrl("https://example.test/x.png")).toBeUndefined();
    expect(decodeDataUrl("data:image/png;base64,%%%")).toBeUndefined();
  });
});

describe("util/rate-limit", () => {
  it("lets `limit` calls through per window, waits for the oldest slot, and refuses waits beyond maxWaitMs", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1_000, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    expect(await limiter.acquire()).toBe(true);
    clock = 400;
    expect(await limiter.acquire()).toBe(true);
    expect(limiter.waitTime()).toBe(600);
    expect(await limiter.acquire(500)).toBe(false);
    expect(await limiter.acquire()).toBe(true);
    expect(waits).toEqual([600]);
    expect(clock).toBe(1_000);
  });
});

describe("util/errors", () => {
  it.each<[StudioErrorCode, number]>([
    ["model_not_found", 404],
    ["not_found", 404],
    ["invalid_request", 400],
    ["media_unresolved", 400],
    ["unauthorized", 401],
    ["webhook_signature_invalid", 401],
    ["insufficient_credits", 402],
    ["provider_rate_limited", 429],
    ["provider_unavailable", 503],
    ["provider_error", 502],
  ])("maps %s to HTTP %i", (code, status) => {
    const error = new StudioError(code, "msg");
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.name).toBe("StudioError");
    expect(error.message).toBe("msg");
    expect(error).toBeInstanceOf(Error);
  });

  it("marks only rate-limit and unavailable errors retryable by default", () => {
    expect(new StudioError("provider_rate_limited", "x").retryable).toBe(true);
    expect(new StudioError("provider_unavailable", "x").retryable).toBe(true);
    expect(new StudioError("provider_error", "x").retryable).toBe(false);
    expect(new StudioError("invalid_request", "x").retryable).toBe(false);
  });

  it("honours explicit status / retryable / details / cause", () => {
    const cause = new Error("root");
    const error = new StudioError("provider_error", "boom", { status: 418, retryable: true, details: { a: 1 }, cause });
    expect(error.status).toBe(418);
    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ a: 1 });
    expect(error.cause).toBe(cause);
  });

  it("serialises to a stable JSON shape", () => {
    const error = new StudioError("not_found", "gone", { details: "d" });
    expect(error.toJSON()).toEqual({ code: "not_found", message: "gone", details: "d", retryable: false });
    expect(JSON.parse(JSON.stringify(error))).toEqual({ code: "not_found", message: "gone", details: "d", retryable: false });
  });

  it("serialises the submission outcome when there is one", () => {
    expect(ambiguousSubmit("provider_error", "maybe").toJSON()).toEqual({ code: "provider_error", message: "maybe", details: { submissionOutcome: "unknown" }, retryable: false, submission_outcome: "unknown" });
  });

  it("classifies submit outcomes for the fallback decision", () => {
    const ambiguous = ambiguousSubmit("provider_unavailable", "gateway", { details: "504" });
    expect(ambiguous).toMatchObject({ submissionOutcome: "unknown", retryable: false, details: { submissionOutcome: "unknown", response: "504" } });
    expect(isAmbiguousSubmission(ambiguous)).toBe(true);
    expect(isSafeToFallBack(ambiguous)).toBe(false);

    const refused = rejectedSubmit("provider_error", "explicit refusal");
    expect(refused.submissionOutcome).toBe("rejected");
    expect(isSafeToFallBack(refused)).toBe(true);
    expect(isSafeToFallBack(rejectedSubmit("invalid_request", "bad input"))).toBe(false);

    // Untagged errors fail closed except for the codes that always mean "not accepted".
    expect(isSafeToFallBack(new StudioError("provider_error", "?"))).toBe(false);
    expect(isSafeToFallBack(new StudioError("provider_unavailable", "?"))).toBe(false);
    for (const code of ["unauthorized", "insufficient_credits", "provider_rate_limited"] as const) expect(isSafeToFallBack(new StudioError(code, "x")), code).toBe(true);
    expect(isSafeToFallBack(new Error("plain"))).toBe(false);
    // Older hosts read details.submissionOutcome; it is honoured on input too.
    expect(new StudioError("provider_error", "x", { details: { submissionOutcome: "unknown" } }).submissionOutcome).toBe("unknown");
  });

  it("tags errors raised inside submit without overwriting an existing outcome", () => {
    const tagged = withSubmissionOutcome(new StudioError("provider_unavailable", "no key"), "rejected") as StudioError;
    expect(tagged.submissionOutcome).toBe("rejected");
    expect(tagged.retryable).toBe(true);
    const kept = ambiguousSubmit("provider_error", "x");
    expect(withSubmissionOutcome(kept, "rejected")).toBe(kept);
    const wrapped = withSubmissionOutcome(new TypeError("boom"), "unknown") as StudioError;
    expect(wrapped).toBeInstanceOf(StudioError);
    expect(wrapped.submissionOutcome).toBe("unknown");
    const plain = new TypeError("boom");
    expect(withSubmissionOutcome(plain, "rejected")).toBe(plain);
  });

  it("knows which submit HTTP statuses leave the outcome unknown", () => {
    expect([500, 502, 504, 520, 524].every(isAmbiguousSubmitStatus)).toBe(true);
    expect([200, 400, 401, 404, 408, 429, 501, 503, 505].some(isAmbiguousSubmitStatus)).toBe(false);
  });

  it("isStudioError narrows correctly", () => {
    expect(isStudioError(new StudioError("not_found", "x"))).toBe(true);
    expect(isStudioError(new Error("x"))).toBe(false);
    expect(isStudioError(null)).toBe(false);
    expect(isStudioError({ code: "not_found" })).toBe(false);
  });
});
