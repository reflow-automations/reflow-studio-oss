import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KIE_USD_PER_CREDIT, KieProvider, creditsOf, parseResultJson, type KieProviderOptions } from "../src/providers/kie/index";
import { isSafeToFallBack } from "../src/util/errors";
import { SlidingWindowLimiter } from "../src/util/rate-limit";
import type { ProviderJobRef } from "../src/jobs/types";
import type { SubmitInput } from "../src/providers/types";
import { callAt, createFakeFetch, emptyResponse, jsonResponse, kieBinding, makeModel, makeRequest, rejection, textResponse, type FakeFetch } from "./_helpers";

const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;
const SECRET = "s3cret";

const model = makeModel();
const jobsBinding = kieBinding();
const veoBinding = kieBinding({
  endpoint: "veo3",
  family: "veo",
  input: { aspect_ratio: { field: "aspectRatio" } },
  output: { outputs: [{ path: "resultUrls[]", kind: "video" }] },
});

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const name of ["KIE_API_KEY", "KIE_WEBHOOK_SECRET"]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterAll(() => {
  for (const [name, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[name] = value;
});

const noSleep = (): Promise<void> => Promise.resolve();

/** Throttle off and no real waiting by default; tests that exercise them pass their own. */
function makeProvider(ff: FakeFetch, extra: Partial<KieProviderOptions> = {}): KieProvider {
  return new KieProvider({ apiKey: "kie-key", webhookSecret: SECRET, fetch: ff.fetch, now: () => NOW_MS, limiter: false, sleep: noSleep, ...extra });
}

function submitInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return { model, binding: jobsBinding, request: makeRequest(), medias: [], webhookUrl: "https://hooks.example/kie/job_1", ...overrides };
}

const jobsRef: ProviderJobRef = { provider: "kie", providerJobId: "task_1", endpoint: "fixture/image", family: "jobs" };
const veoRef: ProviderJobRef = { provider: "kie", providerJobId: "task_v", endpoint: "veo3", family: "veo" };

describe("KieProvider", () => {
  describe("configuration", () => {
    it("is configured only with an api key and refuses to call without one", async () => {
      const ff = createFakeFetch();
      expect(makeProvider(ff).isConfigured()).toBe(true);
      const unconfigured = new KieProvider({ fetch: ff.fetch });
      expect(unconfigured.isConfigured()).toBe(false);
      expect(unconfigured.id).toBe("kie");
      const error = await rejection(unconfigured.submit(submitInput()));
      expect(error.code).toBe("provider_unavailable");
      expect(error.message).toMatch(/KIE_API_KEY/);
      expect(ff.calls).toHaveLength(0);
    });
  });

  describe("submit", () => {
    it("posts jobs-family tasks to /api/v1/jobs/createTask with Bearer auth", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, msg: "success", data: { taskId: "task_1" } }));
      const result = await makeProvider(ff).submit(submitInput());

      expect(ff.calls).toHaveLength(1);
      const call = callAt(ff, 0);
      expect(call.method).toBe("POST");
      expect(call.url).toBe("https://api.kie.ai/api/v1/jobs/createTask");
      expect(call.headers.authorization).toBe("Bearer kie-key");
      expect(call.headers["content-type"]).toBe("application/json");
      expect(call.headers["user-agent"]).toBe("reflow-studio");
      expect(call.json).toEqual({ model: "fixture/image", input: { prompt: "a red fox" }, callBackUrl: "https://hooks.example/kie/job_1" });

      expect(result.ref).toEqual({ provider: "kie", providerJobId: "task_1", endpoint: "fixture/image", family: "jobs" });
      expect(result.providerInput).toEqual({ prompt: "a red fox" });
      expect(result.raw).toEqual({ code: 200, msg: "success", data: { taskId: "task_1" } });
    });

    it("defaults to the jobs family and omits callBackUrl without a webhook", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "task_1" } }));
      const result = await makeProvider(ff).submit(submitInput({ binding: kieBinding({ family: undefined }), webhookUrl: undefined }));
      expect(callAt(ff, 0).json).toEqual({ model: "fixture/image", input: { prompt: "a red fox" } });
      expect(result.ref.family).toBe("jobs");
    });

    it("posts veo-family tasks to /api/v1/veo/generate with callBackUrl merged into the body", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "task_v" } }));
      const result = await makeProvider(ff).submit(submitInput({ binding: veoBinding, request: makeRequest({ aspect_ratio: "16:9" }) }));
      const call = callAt(ff, 0);
      expect(call.url).toBe("https://api.kie.ai/api/v1/veo/generate");
      expect(call.json).toEqual({ prompt: "a red fox", aspectRatio: "16:9", callBackUrl: "https://hooks.example/kie/job_1" });
      expect(result.ref).toEqual({ provider: "kie", providerJobId: "task_v", endpoint: "veo3", family: "veo" });
    });

    it("respects a custom base url", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "t" } }));
      await makeProvider(ff, { baseUrl: "https://kie.example/" }).submit(submitInput());
      expect(callAt(ff, 0).url).toBe("https://kie.example/api/v1/jobs/createTask");
    });

    it.each([
      [402, "insufficient_credits"],
      [429, "provider_rate_limited"],
      [404, "invalid_request"],
      [400, "invalid_request"],
      [422, "invalid_request"],
      [451, "invalid_request"],
      [401, "unauthorized"],
      [455, "provider_unavailable"],
      [500, "provider_unavailable"],
      [505, "provider_unavailable"],
      [418, "provider_error"],
    ])("maps HTTP 200 with body code %i to %s (an explicit refusal)", async (code, expected) => {
      const ff = createFakeFetch(() => jsonResponse({ code, msg: `kie says ${code}` }, 200));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe(expected);
      expect(error.message).toMatch(/^Kie submit:/);
      expect(error.details).toBe(`kie says ${code}`);
      expect(error.submissionOutcome).toBe("rejected");
    });

    it("falls back to the HTTP status when the body is not JSON", async () => {
      const unauthorized = createFakeFetch(() => textResponse("Unauthorized", 401));
      const auth = await rejection(makeProvider(unauthorized).submit(submitInput()));
      expect(auth.code).toBe("unauthorized");
      expect(isSafeToFallBack(auth)).toBe(true);
      const rateLimited = createFakeFetch(() => emptyResponse(429));
      const error = await rejection(makeProvider(rateLimited).submit(submitInput()));
      expect(error.code).toBe("provider_rate_limited");
      expect(error.retryable).toBe(true);
      expect(isSafeToFallBack(error)).toBe(true);
    });

    it.each([500, 502, 504])("treats HTTP %i on createTask as an unknown outcome (the task may exist)", async (status) => {
      const ff = createFakeFetch(() => textResponse("<html>Bad Gateway</html>", status));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("provider_unavailable");
      expect(error.submissionOutcome).toBe("unknown");
      expect(error.retryable).toBe(false);
      expect(isSafeToFallBack(error)).toBe(false);
      expect(ff.calls).toHaveLength(1);
    });

    it("treats code 200 without a taskId (or a 2xx that is not JSON) as an ambiguous provider error", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: {} }));
      const error = await rejection(makeProvider(ff).submit(submitInput()));
      expect(error.code).toBe("provider_error");
      expect(error.submissionOutcome).toBe("unknown");
      expect(isSafeToFallBack(error)).toBe(false);
      const html = createFakeFetch(() => textResponse("<html>proxy page</html>", 200));
      expect((await rejection(makeProvider(html).submit(submitInput()))).submissionOutcome).toBe("unknown");
    });

    it("retries a rate-limited createTask once after a short pause", async () => {
      let calls = 0;
      const ff = createFakeFetch(() => (++calls === 1 ? jsonResponse({ code: 429, msg: "too many requests" }) : jsonResponse({ code: 200, data: { taskId: "task_r" } })));
      const pauses: number[] = [];
      const result = await makeProvider(ff, { sleep: async (ms) => void pauses.push(ms), rateLimitRetryDelayMs: 1200 }).submit(submitInput());
      expect(result.ref.providerJobId).toBe("task_r");
      expect(ff.calls).toHaveLength(2);
      expect(pauses).toEqual([1200]);

      const always = createFakeFetch(() => emptyResponse(429));
      const error = await rejection(makeProvider(always).submit(submitInput()));
      expect(error.code).toBe("provider_rate_limited");
      expect(always.calls).toHaveLength(2);
    });

    it("throttles task creations to the configured window and refuses when the wait would be too long", async () => {
      let clock = NOW_MS;
      const sleep = async (ms: number) => {
        clock += ms;
      };
      const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 5_000, now: () => clock, sleep });
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "t" } }));
      const provider = makeProvider(ff, { limiter, now: () => clock, sleep });
      await provider.submit(submitInput());
      await provider.submit(submitInput());
      expect(clock).toBe(NOW_MS);
      await provider.submit(submitInput());
      expect(clock).toBe(NOW_MS + 5_000);
      expect(ff.calls).toHaveLength(3);

      const impatient = makeProvider(ff, { limiter, now: () => clock, sleep, maxThrottleWaitMs: 1_000 });
      await impatient.submit(submitInput());
      const error = await rejection(impatient.submit(submitInput()));
      expect(error.code).toBe("provider_rate_limited");
      expect(error.submissionOutcome).toBe("rejected");
      expect(ff.calls).toHaveLength(4);
    });

    it("shares one throttle per API key across adapter instances by default", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "t" } }));
      const a = new KieProvider({ apiKey: "shared-key", fetch: ff.fetch, maxThrottleWaitMs: 0 });
      const b = new KieProvider({ apiKey: "shared-key", fetch: ff.fetch, maxThrottleWaitMs: 0 });
      for (let i = 0; i < 10; i++) await a.submit(submitInput());
      for (let i = 0; i < 10; i++) await b.submit(submitInput());
      expect((await rejection(a.submit(submitInput()))).code).toBe("provider_rate_limited");
      expect(ff.calls).toHaveLength(20);
    });

    it("sends a configurable user agent", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "t" } }));
      await makeProvider(ff, { userAgent: "my-studio/1.0" }).submit(submitInput());
      expect(callAt(ff, 0).headers["user-agent"]).toBe("my-studio/1.0");
    });
  });

  describe("getStatus (jobs family)", () => {
    function withRecord(record: Record<string, unknown>): FakeFetch {
      return createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "task_1", ...record } }));
    }

    it("GETs recordInfo with the task id", async () => {
      const ff = withRecord({ state: "waiting" });
      await makeProvider(ff).getStatus(jobsRef, jobsBinding);
      const call = callAt(ff, 0);
      expect(call.method).toBe("GET");
      expect(call.url).toBe("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_1");
      expect(call.headers.authorization).toBe("Bearer kie-key");
    });

    it("url-encodes the task id", async () => {
      const ff = withRecord({ state: "waiting" });
      await makeProvider(ff).getStatus({ ...jobsRef, providerJobId: "a b&c" }, jobsBinding);
      expect(callAt(ff, 0).url).toBe("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=a%20b%26c");
    });

    it("maps waiting/queuing to queued and generating to running", async () => {
      expect((await makeProvider(withRecord({ state: "waiting" })).getStatus(jobsRef, jobsBinding)).state).toBe("queued");
      expect((await makeProvider(withRecord({ state: "queuing" })).getStatus(jobsRef, jobsBinding)).state).toBe("queued");
      const running = await makeProvider(withRecord({ state: "generating", progress: 0.5 })).getStatus(jobsRef, jobsBinding);
      expect(running.state).toBe("running");
      expect(running.progress).toBe(0.5);
    });

    it("parses resultJson as a JSON string on success", async () => {
      const record = { state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png","https://cdn.kie/2.png"]}' };
      const status = await makeProvider(withRecord(record)).getStatus(jobsRef, jobsBinding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toEqual([
        { kind: "image", url: "https://cdn.kie/1.png" },
        { kind: "image", url: "https://cdn.kie/2.png" },
      ]);
      expect(status.raw).toEqual({ taskId: "task_1", ...record });
    });

    it("settles the actual cost from creditsConsumed on the jobs family", async () => {
      const status = await makeProvider(withRecord({ state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png"]}', creditsConsumed: 8 })).getStatus(jobsRef, jobsBinding);
      expect(status.state).toBe("succeeded");
      expect(status.costNative).toBe(8);
      expect(status.costUsd).toBeCloseTo(0.04, 6);
      const failed = await makeProvider(withRecord({ state: "fail", failCode: "422", failMsg: "bad prompt", creditsConsumed: 0 })).getStatus(jobsRef, jobsBinding);
      expect(failed.state).toBe("failed");
      expect(failed.costNative).toBe(0);
      const unknown = await makeProvider(withRecord({ state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png"]}' })).getStatus(jobsRef, jobsBinding);
      expect(unknown.costNative).toBeUndefined();
      expect(unknown.costUsd).toBeUndefined();
    });

    it("also reads consumeCredits and numeric strings", async () => {
      const spelled = await makeProvider(withRecord({ state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png"]}', consumeCredits: "12.5" })).getStatus(jobsRef, jobsBinding);
      expect(spelled.costNative).toBe(12.5);
      expect(spelled.costUsd).toBeCloseTo(0.0625, 6);
      expect(creditsOf({ creditsConsumed: "", consumeCredits: 3 })).toBe(3);
      expect(creditsOf({ creditsConsumed: "n/a" })).toBeUndefined();
      expect(creditsOf({ creditsConsumed: -1 })).toBeUndefined();
    });

    it("also accepts resultJson as an object", async () => {
      const status = await makeProvider(withRecord({ state: "success", resultJson: { resultUrls: ["https://cdn.kie/1.png"] } })).getStatus(jobsRef, jobsBinding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toEqual([{ kind: "image", url: "https://cdn.kie/1.png" }]);
    });

    it("fails on success without result urls or with unparseable resultJson", async () => {
      const empty = await makeProvider(withRecord({ state: "success", resultJson: '{"resultUrls":[]}' })).getStatus(jobsRef, jobsBinding);
      expect(empty.state).toBe("failed");
      expect(empty.error?.code).toBe("no_outputs");
      const broken = await makeProvider(withRecord({ state: "success", resultJson: "{oops" })).getStatus(jobsRef, jobsBinding);
      expect(broken.state).toBe("failed");
      expect(broken.error?.code).toBe("no_outputs");
    });

    it("maps fail to failed with the failure message and code", async () => {
      const status = await makeProvider(withRecord({ state: "fail", failCode: 500, failMsg: "content policy violation" })).getStatus(jobsRef, jobsBinding);
      expect(status.state).toBe("failed");
      expect(status.error).toEqual({ code: "500", message: "content policy violation", retryable: false });
      const bare = await makeProvider(withRecord({ state: "fail" })).getStatus(jobsRef, jobsBinding);
      expect(bare.error).toEqual({ code: "fail", message: "Kie reported failure", retryable: false });
    });

    it("treats unknown states as running", async () => {
      expect((await makeProvider(withRecord({ state: "something_new" })).getStatus(jobsRef, jobsBinding)).state).toBe("running");
      expect((await makeProvider(withRecord({})).getStatus(jobsRef, jobsBinding)).state).toBe("running");
    });

    it("throws mapped errors for envelope failures", async () => {
      const notFound = createFakeFetch(() => jsonResponse({ code: 404, msg: "task not found" }));
      const error = await rejection(makeProvider(notFound).getStatus(jobsRef, jobsBinding));
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/^Kie status:.*task not found/);

      const noData = createFakeFetch(() => jsonResponse({ code: 200 }));
      expect((await rejection(makeProvider(noData).getStatus(jobsRef, jobsBinding))).code).toBe("provider_error");

      const http500 = createFakeFetch(() => textResponse("boom", 500));
      expect((await rejection(makeProvider(http500).getStatus(jobsRef, jobsBinding))).code).toBe("provider_unavailable");
    });

    it("uses the binding family when the ref has none", async () => {
      const ff = withRecord({ state: "waiting" });
      await makeProvider(ff).getStatus({ provider: "kie", providerJobId: "task_1", endpoint: "fixture/image" }, jobsBinding);
      expect(callAt(ff, 0).url).toContain("/api/v1/jobs/recordInfo");
    });
  });

  describe("getStatus (veo family)", () => {
    function withRecord(record: Record<string, unknown>): FakeFetch {
      return createFakeFetch(() => jsonResponse({ code: 200, data: { taskId: "task_v", ...record } }));
    }

    it("GETs record-info and maps successFlag 0 to running", async () => {
      const ff = withRecord({ successFlag: 0 });
      const status = await makeProvider(ff).getStatus(veoRef, veoBinding);
      expect(status.state).toBe("running");
      expect(callAt(ff, 0).url).toBe("https://api.kie.ai/api/v1/veo/record-info?taskId=task_v");
      expect(callAt(ff, 0).headers.authorization).toBe("Bearer kie-key");
    });

    it("maps successFlag 1 with response.resultUrls to succeeded and reports credits", async () => {
      const ff = withRecord({ successFlag: 1, creditsConsumed: 40, response: { resultUrls: ["https://cdn.kie/v.mp4"], resolution: "1080p" } });
      const status = await makeProvider(ff).getStatus(veoRef, veoBinding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toEqual([{ kind: "video", url: "https://cdn.kie/v.mp4" }]);
      expect(status.costNative).toBe(40);
      expect(status.costUsd).toBeCloseTo(40 * KIE_USD_PER_CREDIT, 10);
      expect(status.costUsd).toBeCloseTo(0.2, 10);
    });

    it("falls back to info.resultUrls and leaves cost undefined when not reported", async () => {
      const status = await makeProvider(withRecord({ successFlag: 1, info: { resultUrls: ["https://cdn.kie/v.mp4"] } })).getStatus(veoRef, veoBinding);
      expect(status.state).toBe("succeeded");
      expect(status.outputs).toHaveLength(1);
      expect(status.costNative).toBeUndefined();
      expect(status.costUsd).toBeUndefined();
    });

    it("fails on successFlag 1 without urls", async () => {
      const status = await makeProvider(withRecord({ successFlag: 1, response: {} })).getStatus(veoRef, veoBinding);
      expect(status.state).toBe("failed");
      expect(status.error?.code).toBe("no_outputs");
    });

    it("maps successFlag 2 and 3 to failed with the error message", async () => {
      const failed = await makeProvider(withRecord({ successFlag: 2, errorCode: "422", errorMessage: "prompt rejected", creditsConsumed: 0 })).getStatus(veoRef, veoBinding);
      expect(failed.state).toBe("failed");
      expect(failed.error).toEqual({ code: "422", message: "prompt rejected", retryable: false });
      expect(failed.costNative).toBe(0);
      const three = await makeProvider(withRecord({ successFlag: 3 })).getStatus(veoRef, veoBinding);
      expect(three.state).toBe("failed");
      expect(three.error).toEqual({ code: "3", message: "Kie Veo generation failed", retryable: false });
    });

    it("prefers the family stored on the ref over the binding", async () => {
      const ff = withRecord({ successFlag: 0 });
      await makeProvider(ff).getStatus({ ...veoRef, family: "veo" }, jobsBinding);
      expect(callAt(ff, 0).url).toContain("/api/v1/veo/record-info");
    });
  });

  describe("parseWebhook", () => {
    function signature(taskId: string, timestamp: string | number = NOW_S, secret = SECRET): string {
      return createHmac("sha256", secret).update(`${taskId}.${timestamp}`).digest("base64");
    }
    function signedHeaders(taskId: string, timestamp: string | number = NOW_S, secret = SECRET): Record<string, string> {
      return { "X-Webhook-Timestamp": String(timestamp), "X-Webhook-Signature": signature(taskId, timestamp, secret) };
    }
    const provider = () => makeProvider(createFakeFetch());

    it("verifies HMAC signatures over taskId.timestamp and parses a jobs success payload", async () => {
      const body = JSON.stringify({ code: 200, data: { taskId: "task_1", state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png"]}' } });
      const event = await provider().parseWebhook({ headers: signedHeaders("task_1"), rawBody: body });
      expect(event).toEqual({
        provider: "kie",
        providerJobId: "task_1",
        state: "succeeded",
        payload: { resultUrls: ["https://cdn.kie/1.png"] },
        verified: true,
        payloadAuthenticated: false,
        raw: JSON.parse(body),
      });
    });

    it("forwards creditsConsumed from jobs-family webhooks, converted to USD", async () => {
      const body = JSON.stringify({ code: 200, data: { taskId: "task_9", state: "success", resultJson: '{"resultUrls":["https://cdn.kie/9.png"]}', creditsConsumed: 12 } });
      const event = await provider().parseWebhook({ headers: signedHeaders("task_9"), rawBody: body });
      expect(event.state).toBe("succeeded");
      expect(event.costNative).toBe(12);
      expect(event.costUsd).toBeCloseTo(12 * KIE_USD_PER_CREDIT, 6);
      // Kie signs taskId.timestamp only, so the body (output URLs) is never authenticated.
      expect(event.verified).toBe(true);
      expect(event.payloadAuthenticated).toBe(false);
    });

    it("accepts data.task_id and top-level taskId variants", async () => {
      const snake = JSON.stringify({ data: { task_id: "task_2", state: "success", resultJson: { resultUrls: ["https://cdn.kie/2.png"] } } });
      const snakeEvent = await provider().parseWebhook({ headers: signedHeaders("task_2"), rawBody: snake });
      expect(snakeEvent.providerJobId).toBe("task_2");
      expect(snakeEvent.verified).toBe(true);
      expect(snakeEvent.payload).toEqual({ resultUrls: ["https://cdn.kie/2.png"] });

      const top = JSON.stringify({ taskId: "task_3", data: { state: "waiting" } });
      const topEvent = await provider().parseWebhook({ headers: signedHeaders("task_3"), rawBody: top });
      expect(topEvent.providerJobId).toBe("task_3");
      expect(topEvent.state).toBe("queued");
      expect(topEvent.verified).toBe(true);
    });

    it("maps jobs fail / waiting / generating states", async () => {
      const fail = JSON.stringify({ code: 501, data: { taskId: "task_1", state: "fail", failCode: "422", failMsg: "unsafe prompt" } });
      const failEvent = await provider().parseWebhook({ headers: signedHeaders("task_1"), rawBody: fail });
      expect(failEvent.state).toBe("failed");
      expect(failEvent.error).toEqual({ code: "422", message: "unsafe prompt" });

      const generating = JSON.stringify({ data: { taskId: "task_1", state: "generating" } });
      expect((await provider().parseWebhook({ headers: {}, rawBody: generating })).state).toBe("running");
      const waiting = JSON.stringify({ data: { taskId: "task_1", state: "waiting" } });
      expect((await provider().parseWebhook({ headers: {}, rawBody: waiting })).state).toBe("queued");
    });

    it("parses veo payloads: info.resultUrls, credits, failures and in-progress", async () => {
      const ok = JSON.stringify({ code: 200, msg: "ok", data: { taskId: "task_v", creditsConsumed: 40, info: { resultUrls: ["https://cdn.kie/v.mp4"] } } });
      const okEvent = await provider().parseWebhook({ headers: signedHeaders("task_v"), rawBody: ok });
      expect(okEvent.state).toBe("succeeded");
      expect(okEvent.payload).toEqual({ resultUrls: ["https://cdn.kie/v.mp4"] });
      expect(okEvent.costNative).toBe(40);
      expect(okEvent.verified).toBe(true);

      const viaResponse = JSON.stringify({ code: 200, data: { taskId: "task_v", response: { resultUrls: ["https://cdn.kie/v2.mp4"] } } });
      expect((await provider().parseWebhook({ headers: {}, rawBody: viaResponse })).payload).toEqual({ resultUrls: ["https://cdn.kie/v2.mp4"] });

      const failed = JSON.stringify({ code: 501, msg: "generation failed", data: { taskId: "task_v", creditsConsumed: 0 } });
      const failedEvent = await provider().parseWebhook({ headers: {}, rawBody: failed });
      expect(failedEvent.state).toBe("failed");
      expect(failedEvent.error).toEqual({ code: "501", message: "generation failed" });
      expect(failedEvent.costNative).toBe(0);

      const pending = JSON.stringify({ code: 200, data: { taskId: "task_v" } });
      expect((await provider().parseWebhook({ headers: {}, rawBody: pending })).state).toBe("running");
    });

    it("parses unsigned webhooks with verified=false", async () => {
      const body = JSON.stringify({ data: { taskId: "task_1", state: "success", resultJson: '{"resultUrls":["https://cdn.kie/1.png"]}' } });
      const event = await provider().parseWebhook({ headers: {}, rawBody: body });
      expect(event.verified).toBe(false);
      expect(event.state).toBe("succeeded");
      expect(event.payload).toEqual({ resultUrls: ["https://cdn.kie/1.png"] });
    });

    it("rejects wrong secrets, other task ids, stale timestamps and garbage signatures", async () => {
      const body = JSON.stringify({ data: { taskId: "task_1", state: "waiting" } });
      const p = provider();
      expect((await p.parseWebhook({ headers: signedHeaders("task_1", NOW_S, "wrong"), rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: signedHeaders("task_other"), rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: signedHeaders("task_1", NOW_S - 301), rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: signedHeaders("task_1", NOW_S + 301), rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: signedHeaders("task_1", NOW_S - 300), rawBody: body })).verified).toBe(true);
      expect((await p.parseWebhook({ headers: signedHeaders("task_1", "later"), rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: { "x-webhook-timestamp": String(NOW_S), "x-webhook-signature": "%%%not base64%%%" }, rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: { "x-webhook-timestamp": String(NOW_S), "x-webhook-signature": "AAAA" }, rawBody: body })).verified).toBe(false);
      expect((await p.parseWebhook({ headers: { "x-webhook-signature": signature("task_1") }, rawBody: body })).verified).toBe(false);
    });

    it("honours a custom tolerance and never verifies without a configured secret", async () => {
      const body = JSON.stringify({ data: { taskId: "task_1", state: "waiting" } });
      const strict = makeProvider(createFakeFetch(), { webhookToleranceSeconds: 10 });
      expect((await strict.parseWebhook({ headers: signedHeaders("task_1", NOW_S - 11), rawBody: body })).verified).toBe(false);
      expect((await strict.parseWebhook({ headers: signedHeaders("task_1", NOW_S - 10), rawBody: body })).verified).toBe(true);
      const noSecret = new KieProvider({ apiKey: "kie-key", fetch: createFakeFetch().fetch, now: () => NOW_MS });
      expect((await noSecret.parseWebhook({ headers: signedHeaders("task_1"), rawBody: body })).verified).toBe(false);
    });

    it("returns a failed bad_payload event for unparseable bodies or missing task ids", async () => {
      const garbage = await provider().parseWebhook({ headers: {}, rawBody: "<html>" });
      expect(garbage.state).toBe("failed");
      expect(garbage.error?.code).toBe("bad_payload");
      expect(garbage.providerJobId).toBe("");
      expect(garbage.verified).toBe(false);
      expect(garbage.raw).toBe("<html>");

      const noTask = await provider().parseWebhook({ headers: {}, rawBody: JSON.stringify({ code: 200, data: { state: "success" } }) });
      expect(noTask.state).toBe("failed");
      expect(noTask.error?.code).toBe("bad_payload");
    });
  });

  describe("getBalance", () => {
    it("maps credits to USD at the flat rate", async () => {
      const ff = createFakeFetch(() => jsonResponse({ code: 200, data: 1000 }));
      const balance = await makeProvider(ff).getBalance();
      expect(balance).toEqual({ native: 1000, unit: "credits", usd: 5 });
      expect(callAt(ff, 0).url).toBe("https://api.kie.ai/api/v1/chat/credit");
      expect(callAt(ff, 0).headers.authorization).toBe("Bearer kie-key");
      expect(KIE_USD_PER_CREDIT).toBe(0.005);
    });

    it("returns undefined on envelope or HTTP errors", async () => {
      expect(await makeProvider(createFakeFetch(() => jsonResponse({ code: 401, msg: "nope" }))).getBalance()).toBeUndefined();
      expect(await makeProvider(createFakeFetch(() => jsonResponse({ code: 200, data: "lots" }))).getBalance()).toBeUndefined();
      expect(await makeProvider(createFakeFetch(() => textResponse("down", 500))).getBalance()).toBeUndefined();
    });
  });

  describe("upload", () => {
    it("uploads bytes as a base64 data url", async () => {
      const ff = createFakeFetch(() => jsonResponse({ success: true, code: 200, data: { fileUrl: "https://cdn.kie/up/1.png", expiresAt: "2026-09-08T00:00:00Z" } }));
      const result = await makeProvider(ff).upload({ filename: "a.png", contentType: "image/png", bytes: new Uint8Array([0, 1, 2]) });
      expect(result).toEqual({ url: "https://cdn.kie/up/1.png", expiresAt: "2026-09-08T00:00:00Z" });
      const call = callAt(ff, 0);
      expect(call.url).toBe("https://kieai.redpandaai.co/api/file-base64-upload");
      expect(call.headers.authorization).toBe("Bearer kie-key");
      expect(call.json).toEqual({ base64Data: "data:image/png;base64,AAEC", uploadPath: "reflow-studio", fileName: "a.png" });
    });

    it("uploads by url when only sourceUrl is given and honours uploadPath", async () => {
      const ff = createFakeFetch(() => jsonResponse({ success: true, data: { downloadUrl: "https://cdn.kie/up/2.png" } }));
      const result = await makeProvider(ff, { uploadPath: "custom" }).upload({ filename: "b.png", contentType: "image/png", sourceUrl: "https://origin.test/b.png" });
      expect(result).toEqual({ url: "https://cdn.kie/up/2.png", expiresAt: undefined });
      const call = callAt(ff, 0);
      expect(call.url).toBe("https://kieai.redpandaai.co/api/file-url-upload");
      expect(call.json).toEqual({ fileUrl: "https://origin.test/b.png", uploadPath: "custom", fileName: "b.png" });
    });

    it("maps upload failures and rejects empty input", async () => {
      const ff = createFakeFetch(() => jsonResponse({ success: false, code: 401, msg: "bad key" }, 401));
      expect((await rejection(makeProvider(ff).upload({ filename: "x", contentType: "image/png", bytes: new Uint8Array([1]) }))).code).toBe("unauthorized");
      const empty = createFakeFetch();
      expect((await rejection(makeProvider(empty).upload({ filename: "x", contentType: "image/png" }))).code).toBe("invalid_request");
      expect(empty.calls).toHaveLength(0);
    });
  });
});

describe("parseResultJson", () => {
  it("parses JSON strings and tolerates objects, invalid strings and nullish input", () => {
    expect(parseResultJson('{"resultUrls":["https://x"]}')).toEqual({ resultUrls: ["https://x"] });
    const obj = { resultUrls: [] };
    expect(parseResultJson(obj)).toBe(obj);
    expect(parseResultJson("{not json")).toEqual({});
    expect(parseResultJson("")).toEqual({});
    expect(parseResultJson(undefined)).toEqual({});
    expect(parseResultJson(null)).toEqual({});
    expect(parseResultJson(42)).toBe(42);
  });
});
