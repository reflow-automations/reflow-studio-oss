import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FalProvider, falErrorText, type FalProviderOptions } from "../src/providers/fal/index";
import { isSafeToFallBack } from "../src/util/errors";
import type { ProviderJobRef } from "../src/jobs/types";
import type { SubmitInput } from "../src/providers/types";
import { callAt, createFakeFetch, emptyResponse, falBinding, jsonResponse, makeModel, makeRequest, rejection, textResponse, type FakeFetch, type RecordedCall } from "./_helpers";

const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;
const JWKS_URL = "https://jwks.test/.well-known/jwks.json";

const model = makeModel();
const binding = falBinding();

let savedEnv: string | undefined;
beforeAll(() => {
  savedEnv = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
});
afterAll(() => {
  if (savedEnv !== undefined) process.env.FAL_KEY = savedEnv;
});

function makeProvider(ff: FakeFetch, extra: Partial<FalProviderOptions> = {}): FalProvider {
  return new FalProvider({ apiKey: "test-key", fetch: ff.fetch, jwksUrls: [JWKS_URL], now: () => NOW_MS, ...extra });
}

function submitInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return { model, binding, request: makeRequest(), medias: [], webhookUrl: "https://hooks.example/fal/job_1", ...overrides };
}

const fullRef: ProviderJobRef = {
  provider: "fal",
  providerJobId: "req_1",
  endpoint: "fal-ai/fixture",
  statusUrl: "https://queue.fal.run/fal-ai/fixture/requests/req_1/status",
  responseUrl: "https://queue.fal.run/fal-ai/fixture/requests/req_1",
  cancelUrl: "https://queue.fal.run/fal-ai/fixture/requests/req_1/cancel",
};

describe("FalProvider", () => {
  describe("configuration", () => {
    it("is configured only with an api key and refuses to call without one", async () => {
      const ff = createFakeFetch();
      expect(makeProvider(ff).isConfigured()).toBe(true);
      const unconfigured = new FalProvider({ fetch: ff.fetch });
      expect(unconfigured.isConfigured()).toBe(false);
      expect(unconfigured.id).toBe("fal");
      const error = await rejection(unconfigured.submit(submitInput()));
      expect(error.code).toBe("provider_unavailable");
      expect(error.message).toMatch(/FAL_KEY/);
      expect(ff.calls).toHaveLength(0);
    });
  });

  describe("submit", () => {
    const submitBody = {
      request_id: "req_1",
      status_url: "https://queue.fal.run/fal-ai/fixture/requests/req_1/status",
      response_url: "https://queue.fal.run/fal-ai/fixture/requests/req_1",
      cancel_url: "https://queue.fal.run/fal-ai/fixture/requests/req_1/cancel",
    };

    it("POSTs the mapped body to queue.fal.run/<endpoint>?fal_webhook=... with Key auth", async () => {
      const ff = createFakeFetch(() => jsonResponse(submitBody));
      const result = await makeProvider(ff).submit(submitInput());

      expect(ff.calls).toHaveLength(1);
      const call = callAt(ff, 0);
      expect(call.method).toBe("POST");
      const url = new URL(call.url);
      expect(`${url.origin}${url.pathname}`).toBe("https://queue.fal.run/fal-ai/fixture");
      expect(url.searchParams.get("fal_webhook")).toBe("https://hooks.example/fal/job_1");
      expect(call.headers.authorization).toBe("Key test-key");
      expect(call.headers["content-type"]).toBe("application/json");
      expect(call.headers).not.toHaveProperty("x-fal-object-lifecycle-preference");
      expect(call.json).toEqual({ prompt: "a red fox" });

      expect(result.ref).toEqual({
        provider: "fal",
        providerJobId: "req_1",
        endpoint: "fal-ai/fixture",
        statusUrl: submitBody.status_url,
        responseUrl: submitBody.response_url,
        cancelUrl: submitBody.cancel_url,
      });
      expect(result.providerInput).toEqual({ prompt: "a red fox" });
      expect(result.adjustments).toEqual([]);
      expect(result.raw).toEqual(submitBody);
    });

    it("reports binding-level adjustments with the submit result", async () => {
      const ff = createFakeFetch(() => jsonResponse(submitBody));
      const single = falBinding({ input: { count: null } });
      const result = await makeProvider(ff).submit(submitInput({ binding: single, request: makeRequest({ count: 3 }) }));
      expect(callAt(ff, 0).json).toEqual({ prompt: "a red fox" });
      expect(result.adjustments).toEqual([expect.objectContaining({ field: "count", from: 3, to: 1 })]);
    });

    it("omits fal_webhook when no webhook url is given and composes missing urls", async () => {
      const ff = createFakeFetch(() => jsonResponse({ request_id: "req_2" }));
      const nested = falBinding({ endpoint: "fal-ai/kling-video/v3/pro/image-to-video" });
      const result = await makeProvider(ff).submit(submitInput({ binding: nested, webhookUrl: undefined }));
      expect(callAt(ff, 0).url).toBe("https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video");
      expect(result.ref).toEqual({
        provider: "fal",
        providerJobId: "req_2",
        endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
        statusUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req_2/status",
        responseUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req_2",
        cancelUrl: "https://queue.fal.run/fal-ai/kling-video/requests/req_2/cancel",
      });
    });

    it("includes medias, count and aspect ratio through the binding mapping", async () => {
      const ff = createFakeFetch(() => jsonResponse(submitBody));
      await makeProvider(ff).submit(
        submitInput({
          request: makeRequest({ count: 2, aspect_ratio: "16:9" }),
          medias: [{ role: "image", kind: "image", url: "https://m/1.png", source: "asset_1" }],
        }),
      );
      expect(callAt(ff, 0).json).toEqual({ prompt: "a red fox", aspect_ratio: "16:9", num_images: 2, image_url: "https://m/1.png" });
    });

    it("sends the object lifecycle header when output retention is configured", async () => {
      const ff = createFakeFetch(() => jsonResponse(submitBody));
      await makeProvider(ff, { outputRetentionSeconds: 3600 }).submit(submitInput());
      expect(callAt(ff, 0).headers["x-fal-object-lifecycle-preference"]).toBe('{"expiration_duration_seconds":3600}');
    });

    it("respects a custom queue base url (trailing slash trimmed)", async () => {
      const ff = createFakeFetch(() => jsonResponse(submitBody));
      await makeProvider(ff, { queueBaseUrl: "https://queue.example/" }).submit(submitInput({ webhookUrl: undefined }));
      expect(callAt(ff, 0).url).toBe("https://queue.example/fal-ai/fixture");
    });

    it.each([
      [401, "unauthorized"],
      [403, "unauthorized"],
      [402, "insufficient_credits"],
      [400, "invalid_request"],
      [422, "invalid_request"],
      [429, "provider_rate_limited"],
      [503, "provider_unavailable"],
      [418, "provider_error"],
    ])("maps HTTP %i to %s and marks the submit as rejected", async (status, code) => {
      const ff = createFakeFetch(() => jsonResponse({ detail: "nope" }, status));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe(code);
      expect(error.message).toMatch(/^fal submit:/);
      expect(error.details).toEqual({ detail: "nope" });
      expect(error.submissionOutcome).toBe("rejected");
    });

    it.each([500, 502, 504, 524])("treats HTTP %i on submit as an unknown outcome (the job may be queued)", async (status) => {
      const ff = createFakeFetch(() => textResponse("gateway timeout", status));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("provider_unavailable");
      expect(error.submissionOutcome).toBe("unknown");
      expect(error.retryable).toBe(false);
      expect(error.details).toEqual({ submissionOutcome: "unknown", response: "gateway timeout" });
      expect(isSafeToFallBack(error)).toBe(false);
    });

    it("lets the router fall back after a definite refusal but not after an ambiguous one", async () => {
      const refused = await rejection(makeProvider(createFakeFetch(() => jsonResponse({ detail: "no balance" }, 402))).submit(submitInput()));
      expect(isSafeToFallBack(refused)).toBe(true);
      const busy = await rejection(makeProvider(createFakeFetch(() => emptyResponse(503))).submit(submitInput()));
      expect(isSafeToFallBack(busy)).toBe(true);
      const invalid = await rejection(makeProvider(createFakeFetch(() => jsonResponse({ detail: "bad" }, 422))).submit(submitInput()));
      expect(isSafeToFallBack(invalid)).toBe(false);
    });

    it("rejects without a network call when the key is missing (safe to fall back)", async () => {
      const ff = createFakeFetch();
      const error = await rejection(new FalProvider({ fetch: ff.fetch }).submit(submitInput()));
      expect(error.submissionOutcome).toBe("rejected");
      expect(isSafeToFallBack(error)).toBe(true);
      expect(ff.calls).toHaveLength(0);
    });

    it("formats pydantic-style validation details", async () => {
      const ff = createFakeFetch(() => jsonResponse({ detail: [{ loc: ["body", "prompt"], msg: "field required" }] }, 422));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("invalid_request");
      expect(error.message).toBe("fal submit: body.prompt: field required");
    });

    it("translates a content_policy_violation into a readable, non-retryable invalid_request", async () => {
      const body = { detail: [{ loc: ["body", "image_url"], msg: "Input image contains likenesses of real people", type: "content_policy_violation" }] };
      const ff = createFakeFetch(() => jsonResponse(body, 422));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("invalid_request");
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/^fal submit: fal rejected the input on content-policy grounds/);
      expect(error.details).toEqual(body);
    });

    it("treats a 200 without request_id as an ambiguous provider error", async () => {
      const ff = createFakeFetch(() => jsonResponse({ oops: true }));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("provider_error");
      expect(error.submissionOutcome).toBe("unknown");
      expect(isSafeToFallBack(error)).toBe(false);
    });

    it("treats a transport failure on submit as an unknown outcome", async () => {
      const provider = makeProvider(createFakeFetch(), { fetch: async () => { throw new Error("socket hang up"); } });
      const error = await rejection(provider.submit(submitInput()));
      expect(error.submissionOutcome).toBe("unknown");
      expect(isSafeToFallBack(error)).toBe(false);
    });

    it("rate-limit errors are retryable", async () => {
      const ff = createFakeFetch(() => textResponse("slow down", 429));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.retryable).toBe(true);
      expect(error.status).toBe(429);
    });
  });

  describe("getStatus", () => {
    it("maps IN_QUEUE to queued with the queue position", async () => {
      const ff = createFakeFetch(() => jsonResponse({ status: "IN_QUEUE", queue_position: 3 }));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status).toEqual({ state: "queued", queuePosition: 3, raw: { status: "IN_QUEUE", queue_position: 3 } });
      expect(ff.calls).toHaveLength(1);
      const call = callAt(ff, 0);
      expect(call.method).toBe("GET");
      expect(call.url).toBe(fullRef.statusUrl);
      expect(call.headers.authorization).toBe("Key test-key");
    });

    it("maps IN_PROGRESS to running without fetching the result", async () => {
      const ff = createFakeFetch(() => jsonResponse({ status: "IN_PROGRESS", logs: [{ message: "..." }] }));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("running");
      expect(ff.calls).toHaveLength(1);
    });

    it("fetches the response url on COMPLETED and extracts outputs", async () => {
      const result = { images: [{ url: "https://cdn/1.png", width: 1024, height: 1024, content_type: "image/png" }], seed: 42 };
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse(result)));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toEqual([{ kind: "image", url: "https://cdn/1.png", width: 1024, height: 1024, content_type: "image/png", seed: 42 }]);
      expect(status.raw).toEqual(result);
      expect(ff.calls).toHaveLength(2);
      expect(callAt(ff, 1).url).toBe(fullRef.responseUrl);
      expect(callAt(ff, 1).method).toBe("GET");
      expect(callAt(ff, 1).headers.authorization).toBe("Key test-key");
    });

    it("reports a validation failure when the COMPLETED result is a 422", async () => {
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ detail: "Invalid prompt" }, 422)));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("failed");
      expect(status.error).toEqual({ code: "validation_error", message: "Invalid prompt", retryable: false });
    });

    it("classifies a content-policy 422 result as content_policy with the readable message", async () => {
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ detail: [{ msg: "refused", type: "content_policy_violation" }] }, 422)));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("failed");
      expect(status.error).toMatchObject({ code: "content_policy", retryable: false });
      expect(status.error?.message).toMatch(/real person/);
    });

    it("flattens pydantic detail lists in COMPLETED 422 results", async () => {
      const detail = [
        { loc: ["body", "duration"], msg: "must be <= 15" },
        { loc: ["body", "prompt"], msg: "too long" },
      ];
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ detail }, 422)));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.error).toEqual({ code: "validation_error", message: "body.duration: must be <= 15; body.prompt: too long", retryable: false });
    });

    it.each([500, 502, 503, 504, 408])("throws a retryable error when the COMPLETED result GET hits a transient %i (the output is not lost)", async (code) => {
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : textResponse("<html>bad gateway</html>", code)));
      const error = await rejection(makeProvider(ff).getStatus(fullRef, binding));
      expect(error.code).toBe("provider_unavailable");
      expect(error.retryable).toBe(true);
    });

    it("throws provider_rate_limited when the result GET is rate limited", async () => {
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : emptyResponse(429)));
      const error = await rejection(makeProvider(ff).getStatus(fullRef, binding));
      expect(error.code).toBe("provider_rate_limited");
      expect(error.retryable).toBe(true);
    });

    it("succeeds on the next poll after a transient result failure", async () => {
      let resultCalls = 0;
      const result = { images: [{ url: "https://cdn/1.png" }] };
      const ff = createFakeFetch((call) => {
        if (call.url.endsWith("/status")) return jsonResponse({ status: "COMPLETED" });
        resultCalls += 1;
        return resultCalls === 1 ? textResponse("service unavailable", 503) : jsonResponse(result);
      });
      const provider = makeProvider(ff);
      await rejection(provider.getStatus(fullRef, binding));
      const status = await provider.getStatus(fullRef, binding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toEqual([{ kind: "image", url: "https://cdn/1.png" }]);
    });

    it("keeps a model failure replayed by the queue terminal (fal error body or X-Fal-Error-Type)", async () => {
      const withBody = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ detail: "Inference failed" }, 500)));
      const failed = await makeProvider(withBody).getStatus(fullRef, binding);
      expect(failed.state).toBe("failed");
      expect(failed.error).toEqual({ code: "http_500", message: "Inference failed", retryable: false });

      const withHeader = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : new Response("GPU out of memory", { status: 503, headers: { "x-fal-error-type": "runner_error" } })));
      const oom = await makeProvider(withHeader).getStatus(fullRef, binding);
      expect(oom.state).toBe("failed");
      expect(oom.error).toMatchObject({ code: "http_503", retryable: false });
    });

    it("fails with fal's own error when the COMPLETED status reports one, without fetching the result", async () => {
      const ff = createFakeFetch(() => jsonResponse({ status: "COMPLETED", error: "Model crashed while sampling", error_type: "runner_error" }));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("failed");
      expect(status.error).toEqual({ code: "runner_error", message: "Model crashed while sampling", retryable: false });
      expect(ff.calls).toHaveLength(1);

      const policy = createFakeFetch(() => jsonResponse({ status: "COMPLETED", error: "refused", error_type: "content_policy_violation" }));
      expect((await makeProvider(policy).getStatus(fullRef, binding)).error).toMatchObject({ code: "content_policy", retryable: false });
    });

    it("fails when a COMPLETED result has no media outputs", async () => {
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ images: [] })));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("failed");
      expect(status.error?.code).toBe("no_outputs");
    });

    it("returns a failed state (not a throw) for 404 status lookups", async () => {
      const ff = createFakeFetch(() => jsonResponse({ detail: "Request not found" }, 404));
      const status = await makeProvider(ff).getStatus(fullRef, binding);
      expect(status.state).toBe("failed");
      expect(status.error?.code).toBe("not_found");
    });

    it("throws mapped errors for other status failures", async () => {
      const ff = createFakeFetch(() => textResponse("bad gateway", 502));
      const error = await rejection(makeProvider(ff).getStatus(fullRef, binding));
      expect(error.code).toBe("provider_unavailable");
      expect(error.message).toMatch(/^fal status:/);
    });

    it("composes status/result urls under the root app id for nested endpoints", async () => {
      const ref: ProviderJobRef = { provider: "fal", providerJobId: "abc", endpoint: "fal-ai/kling-video/v3/pro/image-to-video" };
      const ff = createFakeFetch((call) => (call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED" }) : jsonResponse({ video: { url: "https://cdn/v.mp4" } })));
      const videoBinding = falBinding({ endpoint: ref.endpoint, output: { outputs: [{ path: "video", kind: "video" }] } });
      const status = await makeProvider(ff).getStatus(ref, videoBinding);
      expect(status.state).toBe("succeeded");
      expect(callAt(ff, 0).url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/abc/status");
      expect(callAt(ff, 1).url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/abc");
    });

    it("prefers the response_url reported by the status endpoint when the ref lacks one", async () => {
      const ref: ProviderJobRef = { provider: "fal", providerJobId: "abc", endpoint: "fal-ai/fixture" };
      const ff = createFakeFetch((call) =>
        call.url.endsWith("/status") ? jsonResponse({ status: "COMPLETED", response_url: "https://queue.fal.run/custom/result" }) : jsonResponse({ images: [{ url: "https://cdn/1.png" }] }),
      );
      await makeProvider(ff).getStatus(ref, binding);
      expect(callAt(ff, 1).url).toBe("https://queue.fal.run/custom/result");
    });
  });

  describe("cancel", () => {
    it("PUTs the cancel url and returns true only on 202", async () => {
      const ff = createFakeFetch(() => emptyResponse(202));
      expect(await makeProvider(ff).cancel(fullRef)).toBe(true);
      const call = callAt(ff, 0);
      expect(call.method).toBe("PUT");
      expect(call.url).toBe(fullRef.cancelUrl);
      expect(call.headers.authorization).toBe("Key test-key");

      const ff200 = createFakeFetch(() => jsonResponse({ status: "already completed" }, 200));
      expect(await makeProvider(ff200).cancel(fullRef)).toBe(false);
      const ff400 = createFakeFetch(() => jsonResponse({ detail: "cannot cancel" }, 400));
      expect(await makeProvider(ff400).cancel(fullRef)).toBe(false);
    });

    it("composes the cancel url when the ref lacks one", async () => {
      const ff = createFakeFetch(() => emptyResponse(202));
      await makeProvider(ff).cancel({ provider: "fal", providerJobId: "abc", endpoint: "fal-ai/kling-video/v3/pro/image-to-video" });
      expect(callAt(ff, 0).url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/abc/cancel");
    });
  });

  describe("upload", () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const initiateUrl = "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3";

    function storageHandler(call: RecordedCall): Response | undefined {
      if (call.url === initiateUrl) return jsonResponse({ upload_url: "https://upload.test/put/1", file_url: "https://v3.fal.media/files/1.png" });
      if (call.url === "https://upload.test/put/1") return emptyResponse(200);
      return undefined;
    }

    it("initiates the upload then PUTs the bytes", async () => {
      const ff = createFakeFetch(storageHandler);
      const result = await makeProvider(ff).upload({ filename: "a.png", contentType: "image/png", bytes });
      expect(result).toEqual({ url: "https://v3.fal.media/files/1.png" });
      expect(ff.calls).toHaveLength(2);

      const initiate = callAt(ff, 0);
      expect(initiate.method).toBe("POST");
      expect(initiate.headers.authorization).toBe("Key test-key");
      expect(initiate.json).toEqual({ content_type: "image/png", file_name: "a.png" });

      const put = callAt(ff, 1);
      expect(put.method).toBe("PUT");
      expect(put.url).toBe("https://upload.test/put/1");
      expect(put.headers["content-type"]).toBe("image/png");
      expect(put.headers).not.toHaveProperty("authorization");
      expect(put.rawBody).toBe(bytes);
    });

    it("fetches bytes from sourceUrl first when none are given", async () => {
      const ff = createFakeFetch((call) => (call.url === "https://origin.test/src.png" ? new Response(bytes as BodyInit, { status: 200 }) : storageHandler(call)));
      const result = await makeProvider(ff).upload({ filename: "src.png", contentType: "image/png", sourceUrl: "https://origin.test/src.png" });
      expect(result.url).toBe("https://v3.fal.media/files/1.png");
      expect(ff.calls.map((c) => c.url)).toEqual(["https://origin.test/src.png", initiateUrl, "https://upload.test/put/1"]);
      expect(new Uint8Array(callAt(ff, 2).rawBody as Uint8Array)).toEqual(bytes);
    });

    it("maps failures: unreachable source, rejected initiate, failed PUT, no input", async () => {
      const unreachable = createFakeFetch(() => emptyResponse(404));
      expect((await rejection(makeProvider(unreachable).upload({ filename: "x", contentType: "image/png", sourceUrl: "https://origin.test/x" }))).code).toBe("media_unresolved");

      const rejected = createFakeFetch(() => jsonResponse({ detail: "bad key" }, 401));
      expect((await rejection(makeProvider(rejected).upload({ filename: "x", contentType: "image/png", bytes }))).code).toBe("unauthorized");

      const putFails = createFakeFetch((call) => (call.url === initiateUrl ? storageHandler(call) : emptyResponse(500)));
      const putError = await rejection(makeProvider(putFails).upload({ filename: "x", contentType: "image/png", bytes }));
      expect(putError.code).toBe("provider_error");
      expect(putError.message).toContain("500");

      const nothing = createFakeFetch();
      expect((await rejection(makeProvider(nothing).upload({ filename: "x", contentType: "image/png" }))).code).toBe("invalid_request");
      expect(nothing.calls).toHaveLength(0);
    });
  });

  describe("parseWebhook", () => {
    let secretKey: Uint8Array;
    let publicKey: Uint8Array;
    let otherSecretKey: Uint8Array;

    beforeAll(async () => {
      secretKey = ed.utils.randomSecretKey();
      publicKey = await ed.getPublicKeyAsync(secretKey);
      otherSecretKey = ed.utils.randomSecretKey();
    });

    function jwksHandler(call: RecordedCall): Response | undefined {
      if (call.url === JWKS_URL) return jsonResponse({ keys: [{ kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") }] });
      return undefined;
    }

    /** Build headers exactly like fal does: hex Ed25519 signature over id\nuser\nts\nsha256(body). */
    async function sign(body: string, opts: { requestId?: string; userId?: string; timestamp?: string | number; key?: Uint8Array } = {}): Promise<Record<string, string>> {
      const requestId = opts.requestId ?? "req_1";
      const userId = opts.userId ?? "user_42";
      const timestamp = String(opts.timestamp ?? NOW_S);
      const bodySha256 = createHash("sha256").update(body, "utf8").digest("hex");
      const message = new TextEncoder().encode(`${requestId}\n${userId}\n${timestamp}\n${bodySha256}`);
      const signature = await ed.signAsync(message, opts.key ?? secretKey);
      return {
        "x-fal-webhook-request-id": requestId,
        "x-fal-webhook-user-id": userId,
        "x-fal-webhook-timestamp": timestamp,
        "x-fal-webhook-signature": Buffer.from(signature).toString("hex"),
      };
    }

    const okPayload = { images: [{ url: "https://cdn/1.png" }] };
    const okBody = JSON.stringify({ request_id: "req_1", gateway_request_id: "req_1", status: "OK", payload: okPayload });

    it("verifies a correctly signed OK webhook and reports succeeded with the payload", async () => {
      const ff = createFakeFetch(jwksHandler);
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(okBody), rawBody: okBody });
      expect(event).toEqual({
        provider: "fal",
        providerJobId: "req_1",
        state: "succeeded",
        payload: okPayload,
        error: undefined,
        verified: true,
        payloadAuthenticated: true,
        raw: JSON.parse(okBody),
      });
      expect(ff.calls).toHaveLength(1);
      expect(callAt(ff, 0).url).toBe(JWKS_URL);
    });

    it("does not verify a webhook whose signed request id belongs to another job than the body", async () => {
      const ff = createFakeFetch(jwksHandler);
      const provider = makeProvider(ff);
      const otherJob = JSON.stringify({ request_id: "req_2", gateway_request_id: "req_2", status: "OK", payload: okPayload });
      const event = await provider.parseWebhook({ headers: await sign(otherJob, { requestId: "req_1" }), rawBody: otherJob });
      expect(event.verified).toBe(false);
      expect(event.payloadAuthenticated).toBe(false);
      // A retried request signs with its gateway id; that still belongs to the job.
      const retried = JSON.stringify({ request_id: "req_1", gateway_request_id: "gw_7", status: "OK", payload: okPayload });
      expect((await provider.parseWebhook({ headers: await sign(retried, { requestId: "gw_7" }), rawBody: retried })).verified).toBe(true);
    });

    it("refetches the JWKS once after a key rotation, but not on every unknown signature", async () => {
      let clock = NOW_MS;
      let served = otherSecretKey;
      const ff = createFakeFetch((call) => {
        if (call.url !== JWKS_URL) return undefined;
        return ed.getPublicKeyAsync(served).then((key) => jsonResponse({ keys: [{ kty: "OKP", crv: "Ed25519", x: Buffer.from(key).toString("base64url") }] }));
      });
      const provider = makeProvider(ff, { now: () => clock });
      // Cache is fresh: an unknown signature does not trigger a refetch.
      expect((await provider.parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(false);
      expect(ff.calls).toHaveLength(1);
      // Six minutes later fal has rotated to the key we sign with.
      clock = NOW_MS + 6 * 60 * 1000;
      served = secretKey;
      const rotated = await provider.parseWebhook({ headers: await sign(okBody, { timestamp: Math.floor(clock / 1000) }), rawBody: okBody });
      expect(rotated.verified).toBe(true);
      expect(ff.calls).toHaveLength(2);
      // A forged signature right after the refetch does not cause another one.
      expect((await provider.parseWebhook({ headers: await sign(okBody, { timestamp: Math.floor(clock / 1000), key: otherSecretKey }), rawBody: okBody })).verified).toBe(false);
      expect(ff.calls).toHaveLength(2);
    });

    it("caches the JWKS across webhooks on the same adapter", async () => {
      const ff = createFakeFetch(jwksHandler);
      const provider = makeProvider(ff);
      expect((await provider.parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(true);
      expect((await provider.parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(true);
      expect(ff.calls).toHaveLength(1);
    });

    it("accepts mixed-case header names", async () => {
      const ff = createFakeFetch(jwksHandler);
      const signed = await sign(okBody);
      const headers = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.replace(/(^|-)([a-z])/g, (m) => m.toUpperCase()), v]));
      expect(Object.keys(headers)).toContain("X-Fal-Webhook-Signature");
      expect((await makeProvider(ff).parseWebhook({ headers, rawBody: okBody })).verified).toBe(true);
    });

    it("rejects a tampered body but still parses it", async () => {
      const ff = createFakeFetch(jwksHandler);
      const headers = await sign(okBody);
      const tampered = JSON.stringify({ request_id: "req_1", status: "OK", payload: { images: [{ url: "https://evil/1.png" }] } });
      const event = await makeProvider(ff).parseWebhook({ headers, rawBody: tampered });
      expect(event.verified).toBe(false);
      expect(event.state).toBe("succeeded");
      expect(event.providerJobId).toBe("req_1");
    });

    it("rejects tampered headers (request id, user id, timestamp)", async () => {
      const ff = createFakeFetch(jwksHandler);
      const provider = makeProvider(ff);
      const good = await sign(okBody);
      expect((await provider.parseWebhook({ headers: { ...good, "x-fal-webhook-user-id": "someone_else" }, rawBody: okBody })).verified).toBe(false);
      expect((await provider.parseWebhook({ headers: { ...good, "x-fal-webhook-request-id": "req_9" }, rawBody: okBody })).verified).toBe(false);
      expect((await provider.parseWebhook({ headers: { ...good, "x-fal-webhook-timestamp": String(NOW_S - 1) }, rawBody: okBody })).verified).toBe(false);
    });

    it("rejects stale or future timestamps beyond 300 s (boundary inclusive)", async () => {
      const ff = createFakeFetch(jwksHandler);
      const provider = makeProvider(ff);
      expect((await provider.parseWebhook({ headers: await sign(okBody, { timestamp: NOW_S - 301 }), rawBody: okBody })).verified).toBe(false);
      expect((await provider.parseWebhook({ headers: await sign(okBody, { timestamp: NOW_S + 301 }), rawBody: okBody })).verified).toBe(false);
      expect((await provider.parseWebhook({ headers: await sign(okBody, { timestamp: NOW_S - 300 }), rawBody: okBody })).verified).toBe(true);
      expect((await provider.parseWebhook({ headers: await sign(okBody, { timestamp: "soon" }), rawBody: okBody })).verified).toBe(false);
    });

    it("rejects signatures from an unknown key", async () => {
      const ff = createFakeFetch(jwksHandler);
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(okBody, { key: otherSecretKey }), rawBody: okBody });
      expect(event.verified).toBe(false);
    });

    it("rejects malformed signatures and missing headers without touching the JWKS", async () => {
      const ff = createFakeFetch(jwksHandler);
      const provider = makeProvider(ff);
      const good = await sign(okBody);
      expect((await provider.parseWebhook({ headers: { ...good, "x-fal-webhook-signature": "zz" }, rawBody: okBody })).verified).toBe(false);
      expect((await provider.parseWebhook({ headers: { ...good, "x-fal-webhook-signature": "abcd" }, rawBody: okBody })).verified).toBe(false);
      const unsigned = await provider.parseWebhook({ headers: {}, rawBody: okBody });
      expect(unsigned.verified).toBe(false);
      expect(unsigned.state).toBe("succeeded");
      expect(unsigned.providerJobId).toBe("req_1");
      expect(ff.calls).toHaveLength(0);
    });

    it("reports verified=false when the JWKS cannot be loaded or has no usable keys", async () => {
      const down = createFakeFetch(() => emptyResponse(500));
      expect((await makeProvider(down).parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(false);
      const wrongCurve = createFakeFetch(() => jsonResponse({ keys: [{ kty: "EC", crv: "P-256", x: "AAAA" }] }));
      expect((await makeProvider(wrongCurve).parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(false);
      const network = createFakeFetch(() => {
        throw new Error("offline");
      });
      expect((await makeProvider(network).parseWebhook({ headers: await sign(okBody), rawBody: okBody })).verified).toBe(false);
    });

    it("maps status ERROR to failed with the provider message", async () => {
      const ff = createFakeFetch(jwksHandler);
      const body = JSON.stringify({ request_id: "req_1", status: "ERROR", error: "Model exploded", payload: { detail: "boom" } });
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(body), rawBody: body });
      expect(event.state).toBe("failed");
      expect(event.error).toEqual({ code: "provider_error", message: "Model exploded" });
      expect(event.verified).toBe(true);

      const noMessage = JSON.stringify({ request_id: "req_1", status: "ERROR", error: null });
      expect((await makeProvider(ff).parseWebhook({ headers: await sign(noMessage), rawBody: noMessage })).error?.message).toBe("fal reported an error");
    });

    it("classifies a content-policy payload on ERROR webhooks and falls back to payload detail without a top-level error", async () => {
      const ff = createFakeFetch(jwksHandler);
      const refused = JSON.stringify({ request_id: "req_1", status: "ERROR", error: "Request failed", payload: { detail: [{ msg: "The image contains likenesses of real people", type: "content_policy_violation" }] } });
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(refused), rawBody: refused });
      expect(event.state).toBe("failed");
      expect(event.error?.code).toBe("content_policy");
      expect(event.error?.message).toMatch(/content-policy/);

      const detailOnly = JSON.stringify({ request_id: "req_1", status: "ERROR", error: null, payload: { detail: "Invalid prompt" } });
      const fallback = await makeProvider(ff).parseWebhook({ headers: await sign(detailOnly), rawBody: detailOnly });
      expect(fallback.error).toEqual({ code: "provider_error", message: "Invalid prompt" });
    });

    it("maps OK + payload_error to running so the result is fetched via getStatus", async () => {
      const ff = createFakeFetch(jwksHandler);
      const body = JSON.stringify({ request_id: "req_1", status: "OK", payload: null, payload_error: "Payload too large" });
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(body), rawBody: body });
      expect(event.state).toBe("running");
      expect(event.error).toBeUndefined();
      expect(event.verified).toBe(true);
    });

    it("returns a failed bad_payload event for unparseable bodies (signature still checked)", async () => {
      const ff = createFakeFetch(jwksHandler);
      const body = "not json";
      const event = await makeProvider(ff).parseWebhook({ headers: await sign(body, { requestId: "req_7" }), rawBody: body });
      expect(event.state).toBe("failed");
      expect(event.error?.code).toBe("bad_payload");
      expect(event.providerJobId).toBe("req_7");
      expect(event.verified).toBe(true);
      expect(event.raw).toBe(body);
    });
  });
});

describe("falErrorText", () => {
  it("reads strings, detail strings, detail lists and message/error fields", () => {
    expect(falErrorText("boom")).toEqual({ message: "boom", contentPolicy: false });
    expect(falErrorText({ detail: "Invalid prompt" }).message).toBe("Invalid prompt");
    expect(falErrorText({ detail: [{ loc: ["body", "prompt"], msg: "field required" }, "extra"] }).message).toBe("body.prompt: field required; extra");
    expect(falErrorText({ detail: { msg: "single" } }).message).toBe("single");
    expect(falErrorText({ message: "quota" }).message).toBe("quota");
    expect(falErrorText({ error: "down" }).message).toBe("down");
  });

  it("falls back when nothing readable is present", () => {
    expect(falErrorText(undefined)).toEqual({ message: "fal request failed", contentPolicy: false });
    expect(falErrorText(null).contentPolicy).toBe(false);
    expect(falErrorText({}, "custom").message).toBe("custom");
    expect(falErrorText("", "custom").message).toBe("custom");
    expect(falErrorText({ detail: [] }, "custom").message).toBe("custom");
  });

  it("flags content-policy refusals by item type or by message and rewrites the message", () => {
    expect(falErrorText({ detail: [{ type: "content_policy_violation", msg: "nope" }] }).contentPolicy).toBe(true);
    expect(falErrorText({ detail: "Input contains likenesses of real people" }).contentPolicy).toBe(true);
    expect(falErrorText({ detail: [{ msg: "Content policy violation" }] }).contentPolicy).toBe(true);
    expect(falErrorText("content_policy_violation").contentPolicy).toBe(true);
    expect(falErrorText({ detail: [{ type: "value_error", msg: "bad" }] }).contentPolicy).toBe(false);
    expect(falErrorText({ detail: [{ type: "content_policy_violation" }] }).message).toMatch(/real person/);
  });
});
