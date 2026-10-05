import { describe, expect, it } from "vitest";
import { HiggsfieldProvider } from "../src/providers/higgsfield/index";
import type { SubmitInput } from "../src/providers/types";
import type { ProviderBinding } from "../src/catalog/types";
import { isSafeToFallBack } from "../src/util/errors";
import { createFakeFetch, emptyResponse, jsonResponse, makeModel, makeRequest, rejection, textResponse } from "./_helpers";

const binding: ProviderBinding = {
  provider: "higgsfield",
  endpoint: "higgsfield-ai/soul/v2/standard",
  input: { count: null, strictParams: true },
  output: { outputs: [{ path: "images[]", kind: "image" }] },
};
const input: SubmitInput = {
  model: makeModel({ bindings: [binding] }),
  binding,
  request: makeRequest({ prompt: "Portrait in daylight" }),
  medias: [],
  webhookUrl: "https://studio.example/api/webhooks/higgsfield?g=1&t=signed",
};

describe("HiggsfieldProvider", () => {
  it("quotes exact request parameters without starting a generation", async () => {
    const ff = createFakeFetch(() => jsonResponse({ credits: "1.5", usd: "0.094" }));
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: ff.fetch });
    expect(await provider.quote(input)).toBe(0.094);
    expect(ff.calls).toHaveLength(1);
    expect(ff.calls[0]).toMatchObject({ method: "POST", url: "https://api.higgsfield.ai/estimate/higgsfield-ai/soul/v2/standard", json: { prompt: "Portrait in daylight" } });
    expect(ff.calls[0]?.headers.authorization).toBe("Key id:secret");
  });

  it("recognizes descriptive video pricing without inventing a dollar quote", async () => {
    const ff = createFakeFetch(() => jsonResponse({ type: "description", pricing_description: "Rates vary by output dimensions and duration." }));
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: ff.fetch });
    expect(await provider.quote(input)).toBeUndefined();
    expect(ff.calls).toHaveLength(1);
  });

  it("submits, polls, and maps a completed image", async () => {
    const ff = createFakeFetch((call) => call.method === "POST"
      ? jsonResponse({ status: "queued", request_id: "job-1", status_url: "https://platform.higgsfield.ai/requests/job-1/status", cancel_url: "https://platform.higgsfield.ai/requests/job-1/cancel" })
      : jsonResponse({ status: "completed", request_id: "job-1", images: [{ url: "https://cdn.example/image.png" }] }));
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: ff.fetch });
    const submitted = await provider.submit(input);
    expect(new URL(ff.calls[0]!.url).searchParams.get("hf_webhook")).toBe(input.webhookUrl);
    expect(submitted.ref.providerJobId).toBe("job-1");
    expect(submitted.ref.statusUrl).toBe("https://platform.higgsfield.ai/requests/job-1/status");
    expect(await provider.getStatus(submitted.ref, binding)).toMatchObject({ state: "succeeded", outputs: [{ kind: "image", url: "https://cdn.example/image.png" }] });
  });

  it("rejects a status URL outside the API host", async () => {
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: createFakeFetch().fetch });
    await expect(provider.getStatus({ provider: "higgsfield", providerJobId: "job-1", endpoint: binding.endpoint, statusUrl: "https://evil.example/status" }, binding)).rejects.toThrow(/unexpected host/);
  });

  it("treats a transport failure during submission as an unknown outcome", async () => {
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: async () => { throw new Error("connection lost"); } });
    await expect(provider.submit(input)).rejects.toMatchObject({ details: { submissionOutcome: "unknown" }, retryable: false });
  });

  it("keeps an accepted job when the returned status URL is on an unexpected host (composes the API URLs instead)", async () => {
    const ff = createFakeFetch(() => jsonResponse({ status: "queued", request_id: "job-7", status_url: "https://cloud.higgsfield.ai/requests/job-7/status", cancel_url: "not a url" }));
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: ff.fetch });
    const submitted = await provider.submit(input);
    expect(submitted.ref).toEqual({
      provider: "higgsfield",
      providerJobId: "job-7",
      endpoint: binding.endpoint,
      statusUrl: "https://api.higgsfield.ai/requests/job-7/status",
      cancelUrl: "https://api.higgsfield.ai/requests/job-7/cancel",
    });
    expect(submitted.adjustments).toEqual([]);
  });

  it("marks a 2xx without request_id and gateway 5xx responses as unknown outcomes", async () => {
    const noId = await rejection(new HiggsfieldProvider({ credential: "id:secret", fetch: createFakeFetch(() => jsonResponse({ status: "queued" })).fetch }).submit(input));
    expect(noId.code).toBe("provider_error");
    expect(noId.submissionOutcome).toBe("unknown");
    expect(isSafeToFallBack(noId)).toBe(false);
    for (const status of [500, 502, 504]) {
      const error = await rejection(new HiggsfieldProvider({ credential: "id:secret", fetch: createFakeFetch(() => textResponse("upstream", status)).fetch }).submit(input));
      expect(error.submissionOutcome, String(status)).toBe("unknown");
      expect(isSafeToFallBack(error), String(status)).toBe(false);
    }
  });

  it.each([
    [400, "invalid_request", false],
    [401, "unauthorized", true],
    [403, "insufficient_credits", true],
    [429, "provider_rate_limited", true],
    [503, "provider_unavailable", true],
  ])("maps a refused submit (HTTP %i) to %s", async (status, code, fallback) => {
    const error = await rejection(new HiggsfieldProvider({ credential: "id:secret", fetch: createFakeFetch(() => textResponse("nope", status)).fetch }).submit(input));
    expect(error.code).toBe(code);
    expect(error.submissionOutcome).toBe("rejected");
    expect(isSafeToFallBack(error)).toBe(fallback);
  });

  it("refuses to submit without a credential and before any network call", async () => {
    const ff = createFakeFetch();
    const error = await rejection(new HiggsfieldProvider({ fetch: ff.fetch }).submit(input));
    expect(error.code).toBe("provider_unavailable");
    expect(error.submissionOutcome).toBe("rejected");
    expect(ff.calls).toHaveLength(0);
  });

  it("parses webhooks without throwing and never claims a verified payload", async () => {
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: createFakeFetch().fetch });
    const done = await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ request_id: "job-1", status: "completed", images: [{ url: "https://cdn.example/a.png" }] }) });
    expect(done).toMatchObject({ provider: "higgsfield", providerJobId: "job-1", state: "succeeded", verified: false, payloadAuthenticated: false });
    const nsfw = await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ request_id: "job-2", status: "nsfw" }) });
    expect(nsfw).toMatchObject({ state: "failed", error: { code: "nsfw" } });
    expect((await provider.parseWebhook({ headers: {}, rawBody: JSON.stringify({ request_id: "job-3", status: "canceled" }) })).state).toBe("cancelled");
    expect(await provider.parseWebhook({ headers: {}, rawBody: "not json" })).toMatchObject({ providerJobId: "", state: "running", verified: false });
  });

  it("cancels through the stored URL and reports success only on 202", async () => {
    const ff = createFakeFetch(() => emptyResponse(202));
    const provider = new HiggsfieldProvider({ credential: "id:secret", fetch: ff.fetch });
    expect(await provider.cancel({ provider: "higgsfield", providerJobId: "job-1", endpoint: binding.endpoint, cancelUrl: "https://platform.higgsfield.ai/requests/job-1/cancel" })).toBe(true);
    expect(ff.calls[0]).toMatchObject({ method: "POST", url: "https://platform.higgsfield.ai/requests/job-1/cancel" });
  });
});
