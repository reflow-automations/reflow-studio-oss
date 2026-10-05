<!-- Research report generated 2026-09-05 by autonomous research agents; sources are cited inline. Facts marked (unverified)/[M]/[U] were not confirmed against primary sources. -->

# fal.ai API deep-dive (state: early September 2026)

**Sourcing note.** `docs.fal.ai`, `fal.ai`, `blog.fal.ai` and the pricing aggregators are blocked by this session's egress proxy. Facts were reconstructed from primary code (fal-ai/fal-js and fal-ai/fal client sources via raw.githubusercontent.com and GitHub code search), registry metadata (registry.npmjs.org, pypi.org) and search-engine snippets of official docs/model pages. Each fact is tagged: **[V]** verified from source code / registry, **[S]** official doc/model-page snippet seen via search, **[T]** third-party page, **[M]** memory, unverified. Prices are USD and were seen in Jul-Sep 2026 snippets; re-fetch live via the pricing API before committing to a cost model.

---

## 1. Authentication, base URLs, queue contract, webhooks

### 1.1 Keys and scopes
- Header format: `Authorization: Key <FAL_KEY>` on every model/queue/REST call. **[V]** (fal-js `request.ts`, fal-python `client.py`).
- Env var `FAL_KEY`; the SDKs also accept the legacy pair `FAL_KEY_ID:FAL_KEY_SECRET` (server-proxy builds `"${FAL_KEY_ID}:${FAL_KEY_SECRET}"`). **[V]**
- Key scopes: `ADMIN` and `API` (`fal keys create --scope {ADMIN,API}`). Most Platform APIs (model catalog, pricing, usage) accept `API` scope; a few "sensitive" Platform APIs require `ADMIN`. **[S]** https://docs.fal.ai/reference/platform-apis/authentication
- **Short-lived JWT for browsers/realtime**: `POST https://rest.alpha.fal.ai/tokens/` with body `{"allowed_apps": ["<app-alias>"], "token_expiration": <seconds>}` (auth = your server key) returns a JWT string, used by the realtime/WebSocket clients (`?fal_jwt_token=`). Seen in official fal-dart (`lib/src/auth.dart`) and fal-swift (`Realtime.swift`, `token_expiration: 300`). **[V]** The Python client exposes `realtime(..., use_jwt=True, token_expiration=...)`. **[V]**
- **Server-side proxy pattern**: `@fal-ai/server-proxy` **1.2.1** (published 2026-02-20) with adapters for Next.js (app + pages router), Express, Hono, Remix, SvelteKit. Default route `/api/fal/proxy`; browser client sets `fal.config({ proxyUrl: "/api/fal/proxy" })`; the proxy reads target from header `x-fal-target-url`, forwards all `x-fal-*` headers, strips `content-length`/`content-encoding` on the way back, validates the target host is `fal.ai`/`*.fal.ai`/fal.run domains, and injects `Authorization: Key` from `FAL_KEY`. **[V]** https://raw.githubusercontent.com/fal-ai/fal-js/main/libs/proxy/src/index.ts

### 1.2 Base URLs **[V]/[S]**
| Surface | URL |
|---|---|
| Synchronous run | `https://fal.run/{endpoint_id}` (POST) |
| Queue (async) | `https://queue.fal.run/{endpoint_id}` |
| HTTP-over-WebSocket | `wss://ws.fal.run/{endpoint_id}` |
| Realtime (msgpack, custom apps) | `wss://fal.run/{app}/realtime` (default path `/realtime`) |
| Legacy REST/platform | `https://rest.alpha.fal.ai` (tokens, storage initiate, JWKS); newer client builds also reference `https://rest.fal.ai` |
| Platform APIs v1 | `https://api.fal.ai/v1/...` (models, pricing, usage) |
| CDN | `https://v3.fal.media/files/...` (also `v3b.fal.media`) |
| Per-endpoint OpenAPI | `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={id}` |
| MCP | `https://mcp.fal.ai/mcp` |

### 1.3 Queue API contract **[S]** (docs.fal.ai/model-apis/model-endpoints/queue) + **[V]** (fal-js `queue.ts`)
1. **Submit**: `POST https://queue.fal.run/{endpoint_id}` JSON body = model input. Optional query `?fal_webhook=https://...`. Response: `{"request_id": "...", "response_url": "...", "status_url": "...", "cancel_url": "..."}` (status `IN_QUEUE`).
2. **Status**: `GET https://queue.fal.run/{endpoint_id}/requests/{request_id}/status?logs=1` → `{"status": "IN_QUEUE"|"IN_PROGRESS"|"COMPLETED", "queue_position": n, "logs": [...], "metrics": {...}, "response_url": ...}`. `logs=1` enables log lines. SSE variant: `.../status/stream`.
3. **Result**: `GET https://queue.fal.run/{endpoint_id}/requests/{request_id}` → model output JSON.
4. **Cancel**: `PUT https://queue.fal.run/{endpoint_id}/requests/{request_id}/cancel` → `202 CANCELLATION_REQUESTED` or `400 ALREADY_COMPLETED`. Queued requests are removed; in-progress ones get a cancel signal.
5. **Gotcha [M]**: for nested endpoint ids (e.g. `fal-ai/kling-video/v3/pro/image-to-video`) the status/result URLs are built on the *root app id* (`queue.fal.run/fal-ai/kling-video/requests/{id}/...`). Always use the `status_url`/`response_url` returned by submit rather than composing paths.
6. **Request headers** (all optional) **[V]** from fal-js `headers.ts`/`queue.ts` and fal-python `_headers.py`:
   - `X-Fal-Queue-Priority: normal|low` (SDK option `priority`; `low` = cheaper-behaving slot)
   - `X-Fal-Runner-Hint: <string>` (SDK `hint`; sticky routing to a warm runner)
   - `X-Fal-Request-Timeout: <seconds>` (`startTimeout`; deadline to *start*, 504 if no runner picks it up, does not cap inference time) and `X-Fal-Request-Timeout-Type`
   - `X-Fal-No-Retry: 1` (disable automatic server-side retries)
   - `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": N | null}` (also sent as `X-Fal-Object-Lifecycle`), output media retention
   - `X-Fal-Store-IO: 0`, do not persist request/response payloads **[T]**
7. **Concurrency**: every account has a global concurrency limit on `IN_PROGRESS` requests; **new accounts start at 2** and the limit scales automatically with paid credit purchases; excess requests are **never rejected with 429**: they wait in the queue and are re-dispatched with exponential backoff, no max retry count; "there is no queue size limit". **[S]** https://fal.ai/docs/documentation/model-apis/concurrency-limits , https://docs.fal.ai/model-apis/faq
8. Request inputs/outputs (JSON payloads) are stored for **30 days by default**. **[S]** https://docs.fal.ai/model-apis/payloads

### 1.4 Webhooks **[S]** https://docs.fal.ai/model-apis/model-endpoints/webhooks + **[V]** integrator code
- Register per request with `?fal_webhook=<https URL>` on the queue submit (JS `webhookUrl`, Python `webhook_url`).
- Payload: `{"request_id": "...", "gateway_request_id": "..."|null, "status": "OK"|"ERROR", "payload": <output or null>, "error": "..."?, "payload_error": "..."?}`, `payload_error` is set when the job succeeded but the result could not be serialized into the webhook (fetch it via the result URL).
- Delivery timeout 15 s. Retry policy is documented two ways (docs changed in 2026): older text "retry 10 times in the span of 2 hours"; newer text "retried with increasing backoff until the stored result expires (~1 h after completion, ~6 min for results ≥10 KB), up to 31 retries". Design handlers as idempotent on `request_id`. **[S]**
- **Signature verification**: headers `X-Fal-Webhook-Request-Id`, `X-Fal-Webhook-User-Id`, `X-Fal-Webhook-Timestamp`, `X-Fal-Webhook-Signature` (hex, **ED25519**). Message = `request_id + "\n" + user_id + "\n" + timestamp + "\n" + sha256_hex(raw_body)`. Public keys: JWKS at `https://rest.alpha.fal.ai/.well-known/jwks.json` (each `keys[].x` is a base64url ED25519 public key; try all keys; cache ≤24 h). Reject if `|now - timestamp| > 300 s`. **[V]** (multiple verifier implementations: cjmellor/fal-ai-laravel, Hookflo/tern, edenartlab/eve).

### 1.5 Timeouts, sync vs async
- `fal.run` (sync) blocks until completion; use only for sub-minute jobs. For video/3D/training always use the queue (the official MCP server's own guidance). **[S]**
- `startTimeout`/`X-Fal-Request-Timeout` only bounds time-to-start. Client-side, fal-js `subscribe` has `timeout` (ms) and `pollInterval`; Python `subscribe` has `client_timeout`, `interval`. **[V]**

---

## 2. Storage / CDN / result lifetime

- **JS upload flow** **[V]** (`libs/client/src/storage.ts`): `POST {rest}/storage/upload/initiate?storage_type=fal-cdn-v3` with `{content_type, file_name}` → `{upload_url, file_url}`; client PUTs bytes to `upload_url`; files **> 90 MB** use `initiate-multipart` + `PUT {upload_url}/{partNumber}` (10 MB parts, returns `etag`) + `POST {upload_url}/complete`. `fal.storage.transformInput()` recursively auto-uploads any `Blob`/`File` found in the input object and replaces it with the URL (this is what `fal.subscribe` does for you).
- **Python upload flow** **[V]** (`fal_client/client.py` 1.0.1): `upload(data, content_type, file_name, lifecycle)`, `upload_file(path)`, `upload_image(PIL)`; CDN endpoint `POST https://v3.fal.media/files/upload`; multipart threshold **100 MB**, 10 MB chunks, 10 concurrent workers.
- **Lifecycle / expiry** **[V]**: `StorageSettings.expires_in ∈ {"never","immediate","1h","1d","7d","30d","1y", <int seconds>}` plus `initial_acl` (per-user `hide|forbid|allow`). Serialized to `X-Fal-Object-Lifecycle(-Preference)` JSON. `{"expiration_duration_seconds": null}` = never expire.
- **Defaults** **[S]** (docs "media-expiration", "fal-cdn"): generated media is kept on the CDN **for at least 7 days by default**; uploaded inputs follow the same retention controls; URLs are public (no auth) and permanently deleted after expiry. → **Architecture consequence: copy every result you want to keep into your own object store (S3/R2/Supabase Storage) at webhook time, or set a long lifecycle on submit.**
- Max upload size: no documented platform limit ("no file type restrictions at the upload level; individual models enforce their own size/format limits"). **[S]**
- **Data-URI inputs**: any `*_url` field accepts a `data:` base64 URI; docs warn large data URIs hurt request performance; no hard byte limit is published. **[S]**

---

## 3. Client SDKs, schemas, model catalog API

### 3.1 `@fal-ai/client`: latest **1.10.1** (alpha tag 1.11.0-alpha.2), Node ≥18, MIT, repo `fal-ai/fal-js` → `libs/client` **[V]** (registry.npmjs.org)
```ts
import { fal } from "@fal-ai/client";            // or createFalClient(config)
fal.config({ credentials, proxyUrl, requestMiddleware, fetch, suppressLocalCredentialsWarning });
await fal.run(id, { input, method?, abortSignal?, startTimeout?, storageSettings? });
const { data, requestId } = await fal.subscribe(id, {
  input, logs: true, mode: "polling"|"streaming", pollInterval, timeout,
  onEnqueue(requestId), onQueueUpdate(status), webhookUrl, priority: "normal"|"low",
  hint, startTimeout, abortSignal, storageSettings });
await fal.queue.submit(id, { input, webhookUrl, priority, hint, startTimeout, headers });
await fal.queue.status(id, { requestId, logs: true });      // + streamStatus / subscribeToStatus
await fal.queue.result(id, { requestId });  await fal.queue.cancel(id, { requestId });
const stream = await fal.stream(id, { input }); for await (const ev of stream) {...}; await stream.done();
const conn = fal.realtime.connect(app, { throttleInterval, connectionKey, onResult, onError, maxBuffering, clientOnly });
const url = await fal.storage.upload(file);
import type { EndpointTypeMap } from "@fal-ai/client/endpoints";  // typed input/output per endpoint
```
Typed endpoints: the `./endpoints` subpath export maps endpoint ids to `InputType<Id>`/`OutputType<Id>`. **[V]**

### 3.2 `fal-client` (Python): **1.0.1**, released 2026-08-19, repo `fal-ai/fal` (`projects/fal_client`) **[V]**
Sync & async clients (`fal_client.run/submit/subscribe/stream/status/result/cancel/get_handle` + `*_async`), `upload/upload_file/upload_image`, `encode/encode_file/encode_image` (data-URI), `realtime()`/`ws_connect()`; parameters `hint`, `priority`, `webhook_url`, `start_timeout`, `with_logs`, `on_queue_update`, `lifecycle`. Handle objects expose `iter_events()` yielding `Queued(position)`, `InProgress(logs)`, `Completed`.

### 3.3 Per-endpoint OpenAPI schema (for a dynamic catalog / auto-generated forms) **[V]/[S]**
- `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux/dev` (unauthenticated in practice; official docs "OpenAPI Schema" page). **[S]** https://docs.fal.ai/reference/platform-apis/openapi-schema
- `GET https://api.fal.ai/v1/models?endpoint_id={id}&expand=openapi-3.0` returns the model plus an `openapi` object whose `x-fal-metadata` carries `{endpointId, category, playgroundUrl, documentationUrl}` and `components.schemas.{Input,Output}`. **[V]** (fal-ai-community/n8n-nodes-fal)
- Every model page also serves `https://fal.ai/models/{endpoint_id}/llms.txt`, a plain-text API description for agents. **[S]**

### 3.4 Models catalog API (what Higgsfield's `models_explore` would be built on) **[V]** (n8n-nodes-fal, several integrators, one live probe note dated 2026-06-12)
- `GET https://api.fal.ai/v1/models` with `Authorization: Key` (API scope). Query params: `limit` (≤50 per page in the n8n node; some clients use 100), `cursor`, `q` (free-text search), `endpoint_id` (single or comma list), `expand=openapi-3.0`, plus category filtering (`category=`) reported by integrators.
- Response: `{"models": [{"endpoint_id": "...", "metadata": {"display_name", "category", "description", "status", "thumbnail_url", "license_type", "tags": [], "highlighted", "pinned", "updated_at", "model_url"}, "openapi"?: {...}}], "next_cursor": "...", "has_more": bool}`.
- Categories observed: `text-to-image, image-to-image, text-to-video, image-to-video, video-to-video, text-to-audio, audio-to-audio, audio-to-video, speech-to-text, text-to-speech, image-to-3d, text-to-3d, vision, llm, training, ...` (upscalers are `image-to-image`, filter with `q=upscale`). **[V]**
- fal exposes ~1,000-1,300 endpoints; third-party crawls (PHY041/fal-ai-model-database, 1,094 models with prices/categories) exist as a fallback. **[T]**

### 3.5 Pricing / usage Platform APIs **[V]** (thorwhalen/falaw, openstory, simstudio, luisfarfan/openrouter-insights)
- `GET https://api.fal.ai/v1/models/pricing?endpoint_id=a&endpoint_id=b` (repeat param or comma list; **max 50 ids per call**; 404 for unknown ids) → `{"prices": [{"endpoint_id", "unit_price", "unit", "currency": "USD"}], "has_more", "next_cursor"}`. Free but authenticated.
- `POST https://api.fal.ai/v1/models/pricing/estimate`, estimate cost for a set of endpoints × call counts (Higgsfield `get_cost:true` equivalent).
- `GET https://api.fal.ai/v1/models/usage`, paginated usage records filterable by endpoint, user, date range, auth method; each item has unit quantity, `unit_price`, `cost_subtotal`, discount %, `cost_total`. **[S]** https://fal.ai/docs/platform-apis/v1/models/usage
- Billing dashboard shows spend/invoices; **no self-serve hard spend cap was found** in docs, implement your own budget guard using `/pricing/estimate` + `/usage`. **[S/M]**

### 3.6 Pricing model **[S]**
Output-based per endpoint: per image, per megapixel (input+output MP, rounded up), per second of video (often × resolution × audio on/off), per 1,000 characters (TTS), per audio minute (STT/dubbing), per generation (3D), per training step, per token (LLM/VLM), and some legacy models per GPU-second (e.g. `$0.00111/s` ESRGAN). Prepaid credits; concurrency tier follows purchase history; enterprise gets negotiated concurrency/SLAs. The `unit` string in the pricing API tells you which.

---

## 4. Official MCP server, Workflows, Playground/Sandbox

- **MCP**: hosted at `https://mcp.fal.ai/mcp` (Streamable HTTP), auth `Authorization: Bearer <FAL_KEY>` (`claude mcp add --transport http fal-ai https://mcp.fal.ai/mcp --header "Authorization: Bearer $FAL_KEY"`). Nine tools: discovery `search_models`, `get_model_schema`, `get_pricing`, `search_docs`, `recommend_model`; execution `run_model` (short sync jobs), `submit_job` + `check_job` (async; recommended for video/3D/training); utility `upload_file`. Some registries also list `get_job_result` and `cancel_job`. Server is free; model runs billed at standard prices; nothing stored server-side. **[V]** (multiple GitHub configs) + **[S]** https://fal.ai/docs/documentation/setting-up/mcp
  - Design lesson vs Higgsfield: fal's MCP is *catalog-first* (search → schema → pricing → run), while Higgsfield's is *task-first* (`generate_image/video/audio`, medias with roles, adjustments, widgets). Your MCP can combine both: typed task tools on top, plus `models_explore` backed by `/v1/models` + pricing.
- **Workflows** **[S]** https://docs.fal.ai/model-apis/model-endpoints/workflows : chain models into one endpoint id `workflows/{owner}/{name}` (e.g. `workflows/fal-ai/sdxl-sticker` = fast-sdxl → rembg → face-to-sticker). Run through the normal queue or `fal.stream("workflows/...")`; events `submit` (app_id, request_id, node_id) and `completion` per step give intermediate results. A `workflows/execute` endpoint runs ad-hoc workflow definitions; a visual builder exists in the dashboard (fal.ai/workflows) **[M]**. Good fit for "presets" like Higgsfield's image-to-video presets and for Soul-like pipelines (train LoRA → generate → upscale).
- **Playground / Sandbox** **[S]**: each model page has tabs Playground (form auto-generated from the input schema, required fields flagged, file upload widgets), API (schemas + code), Examples, and `/llms.txt`. "Sandbox" is a separate multi-model comparison UI with model sets, per-run cost estimates, history search and share links, a strong design reference for a Higgsfield-style studio.

---

## 5. Limits, safety, licensing
- Concurrency: default **2** in-progress requests for new accounts, auto-scaling with credits; queue instead of 429. **[S]**
- Request size: no published byte limit; large base64 inputs are discouraged; use CDN URLs. **[S]**
- `enable_safety_checker` (default `true`) on most image models; not all models allow disabling; outputs include `has_nsfw_concepts: bool[]`; `safety_tolerance` (1-6) on FLUX Pro family **[M]**. **[S]** https://fal.ai/docs/documentation/model-apis/model-arguments
- Policy: Trust & Safety + Acceptable Use Policy prohibit CSAM/NCII/illegal content; ToS: customers own output within provider licenses, fal gives no originality/non-infringement warranty; commercial use depends on the upstream model license (`metadata.license_type` in the catalog, e.g. `commercial` vs research-only for some open weights such as older Hunyuan/Wan checkpoints). **[S]** https://fal.ai/legal/terms-of-service , https://fal.ai/legal/acceptable-use-policy

---

## 6. Model catalog with endpoint ids and prices (Sept 2026)

All ids are `endpoint_id` strings for `queue.fal.run/{id}`. Prices from fal model pages via search snippets **[S]** unless marked **[T]**.

### 6.1 Text-to-image
| capability | endpoint_id | key params | price/unit | notes |
|---|---|---|---|---|
| FLUX.2 [pro] | `fal-ai/flux-2-pro` | prompt, image_size/aspect_ratio, num_images, seed, enable_safety_checker | $0.03 first MP + $0.015/extra MP (in+out) | 1920×1080 ≈ $0.045 |
| FLUX.2 [flex] | `fal-ai/flux-2-flex` | + num_inference_steps, guidance_scale | $0.05/MP | |
| FLUX.2 [max] | `fal-ai/flux-2-max` | | $0.07 first MP + $0.03/extra MP | |
| FLUX.2 [dev] | `fal-ai/flux-2` | | $0.012/MP | open weights; LoRA variant `fal-ai/flux-2/lora` $0.021/MP (+50%/GB over 2 GB) |
| FLUX 1.1 [pro] ultra | `fal-ai/flux-pro/v1.1-ultra` | aspect_ratio, raw | $0.06/image (4 MP) | |
| Nano Banana | `fal-ai/nano-banana` | prompt, num_images, output_format | $0.039/image | Gemini 2.5 Flash Image |
| Nano Banana 2 | `fal-ai/nano-banana-2` (= `fal-ai/gemini-3.1-flash-image-preview`) | resolution 512/1K/2K/4K | from ~$0.0225 (512px) to $0.06+/image; edit $0.08 | **[T]** Lumenfall/OpenRouter |
| Nano Banana Pro | `fal-ai/nano-banana-pro` (= `fal-ai/gemini-3-pro-image-preview`) | resolution 1K/2K/4K, web search | $0.15/image; 2K ×1.5, 4K ×2 ($0.30); 512px ×0.75; +$0.015 with web search | |
| Seedream 4.5 | `fal-ai/bytedance/seedream/v4.5/text-to-image` | image_size up to 4K | $0.04/image | |
| Seedream 5.0 Lite | `fal-ai/bytedance/seedream/v5/lite/text-to-image` | | $0.035/image | edit: `.../v5/lite/edit` |
| Seedream 5.0 Pro | `bytedance/seedream/v5/pro/text-to-image` | | $0.0675 (≤1536²) / $0.135 (≤2048²) | note owner prefix `bytedance/` |
| GPT-Image 1.5 | `fal-ai/gpt-image-1.5` | quality low/medium/high, size | low $0.009-0.013; medium $0.034-0.051; high $0.133-0.200 | edit: `fal-ai/gpt-image-1.5/edit` |
| GPT Image 2 | `openai/gpt-image-2` | quality, size up to 4K | $0.01 (low 1024×768) → $0.41 (high 4K) | **[T]** |
| Recraft V3 | `fal-ai/recraft/v3/text-to-image` | style, colors | $0.04/image | vector variant $0.08 |
| Recraft V4 / V4 Pro / V4.1 | `fal-ai/recraft/v4/text-to-image`, `.../v4/pro/text-to-image`, `.../v4/text-to-vector` | | V4.1 std $0.04; V4 Pro $0.25; vector $0.08 | |
| Ideogram V3 | `fal-ai/ideogram/v3` | rendering_speed TURBO/BALANCED/QUALITY, style | $0.03 / $0.06 / $0.09 | `.../v3/edit`, `.../v3/reframe`; Character: `fal-ai/ideogram/character` $0.10/0.15/0.20 |
| Qwen Image 2.0 | `fal-ai/qwen-image-2/text-to-image` | | $0.035/image; Pro `.../pro/edit` $0.075 | original `fal-ai/qwen-image` $0.02/MP |
| Z-Image Turbo | `fal-ai/z-image/turbo` | | $0.005/MP; LoRA `.../turbo/lora` $0.0085/MP | trainer `fal-ai/z-image-trainer` |
| Grok Imagine Image | `xai/grok-imagine-image` (+`/quality/text-to-image`, `/edit`) | quality low/medium, 1K/2K | $0.04-0.08/image (1K $0.05, 2K $0.07); edit $0.022 | |

### 6.2 Image editing / inpaint / outpaint
| capability | endpoint_id | key params | price/unit | notes |
|---|---|---|---|---|
| FLUX.1 Kontext pro / max | `fal-ai/flux-pro/kontext`, `fal-ai/flux-pro/kontext/max` (`/multi`, `/text-to-image`) | image_url(s), prompt | $0.04 / $0.08 per image | |
| FLUX.2 edit | `fal-ai/flux-2-pro/edit`, `fal-ai/flux-2/edit`, `fal-ai/flux-2-max/edit`, `fal-ai/flux-2/lora/edit` | image_urls (multi-ref) | pro $0.03/MP; dev $0.012/MP; max $0.07+$0.03/MP | |
| FLUX.2 pro outpaint | `fal-ai/flux-2-pro/outpaint` | image_url, expand px per side | (same MP rate) | Higgsfield `flux_2_pro_outpaint` |
| FLUX.1 pro Fill (inpaint/outpaint) | `fal-ai/flux-pro/v1/fill` | image_url, mask_url | $0.05/MP | |
| Nano Banana edit | `fal-ai/nano-banana/edit`, `fal-ai/nano-banana-pro/edit` | image_urls | $0.039 / $0.15 | |
| Seedream edit | `fal-ai/bytedance/seedream/v4/edit`, `.../v4.5/edit`, `.../v5/lite/edit` | image_urls | ~$0.03-0.04 | |
| Ideogram V3 edit/reframe | `fal-ai/ideogram/v3/edit`, `fal-ai/ideogram/v3/reframe` | | $0.03-0.09 | image reframe |

### 6.3 Image utilities
| capability | endpoint_id | price/unit | notes |
|---|---|---|---|
| Topaz image upscale | `topaz/upscale/image/precision` (also `fal-ai/topaz/upscale/image`) | $0.08 per started 24 MP output | Higgsfield `topaz_image` |
| Clarity upscaler | `fal-ai/clarity-upscaler` | $0.03/MP | Crystal: `clarityai/crystal-upscaler` |
| AuraSR | `fal-ai/aura-sr` | ~$0.001/compute-s | |
| ESRGAN | `fal-ai/esrgan` | $0.00111/compute-s | |
| SeedVR2 image | `fal-ai/seedvr/upscale/image` | $0.001/MP | up to 10K |
| Bria RMBG 2.0 | `fal-ai/bria/background/remove` | $0.018/image | replace: `fal-ai/bria/background/replace` |
| BiRefNet v2 | `fal-ai/birefnet` (`/v2`) | $0.0008/compute-s | |
| ByteDance upscaler | `fal-ai/bytedance-upscaler/upscale/image` **[M]** / `.../upscale/video` | video: $0.0072/s 1080p, $0.0144/s 2K, $0.0288/s 4K | Higgsfield `bytedance_image_upscale`/`bytedance_video_upscale` |

### 6.4 Text/image-to-video
| capability | endpoint_id | key params | price/unit | notes |
|---|---|---|---|---|
| Veo 3.1 | `fal-ai/veo3.1`, `/image-to-video`, `/first-last-frame-to-video`, `/reference-to-video` **[M]** | duration 4/6/8s, resolution 720p/1080p/4K, generate_audio, aspect_ratio | $0.20/s (no audio) / $0.40/s (audio); 4K $0.40/$0.60 | |
| Veo 3.1 Fast | `fal-ai/veo3.1/fast`, `/fast/image-to-video`, `/fast/first-last-frame-to-video` | | $0.10/$0.15 per s; 4K $0.30/$0.35 | 8 s max |
| Veo 3.1 Lite | `fal-ai/veo3.1/lite`, `/lite/image-to-video` | | 720p $0.03/$0.05; 1080p $0.05/$0.08 per s | |
| Veo 3 / Veo 3 Fast | `fal-ai/veo3`, `fal-ai/veo3/fast` | | $0.20/$0.40; fast $0.10/$0.15 per s | |
| Kling 3.0 std/pro | `fal-ai/kling-video/v3/standard/{text-to-video,image-to-video}`, `.../v3/pro/...`, `.../v3/4k/...` | prompt, duration 3-15 s, aspect_ratio, generate_audio, voice control, `elements[]`, `multi_prompt[]` (1-6 shots, ≤15 s), `end_image_url` | std $0.084 (audio off)/$0.126 (audio)/$0.154 (voice); pro $0.112/$0.168/$0.196 per s; 4K $0.42/s | Higgsfield `kling3_0` |
| Kling 3.0 Turbo | `fal-ai/kling-video/v3/turbo/{standard,pro}/{text,image}-to-video` | | std $0.112/s; pro $0.14/s | |
| Kling O3 | `fal-ai/kling-video/o3/{standard,pro,4k}/{text,image}-to-video`, `.../o3/pro/video-to-video/edit` | | std $0.084/$0.112; pro $0.112/$0.14; 4K $0.42 per s | omni/edit model |
| Kling 2.6 | `fal-ai/kling-video/v2.6/{standard,pro}/{text,image}-to-video` | | pro $0.07 (no audio)/$0.14 (audio)/$0.168 (voice) per s | |
| Kling 2.5 Turbo | `fal-ai/kling-video/v2.5-turbo/pro/{text,image}-to-video` | | ~$0.07/s **[M]** | |
| Seedance 2.0 | `bytedance/seedance-2.0/{text-to-video,image-to-video,reference-to-video}` | duration, resolution 480p/720p/1080p, refs (images+video+audio) | 720p $0.3034/s; 1080p $0.682/s; ref-to-video with video inputs from $0.145/s (fast) | owner prefix `bytedance/`; 4K variant exists |
| Seedance 2.0 Fast | `bytedance/seedance-2.0/fast/{text,image,reference}-to-video` | | ~$0.242 per 10 s clip (≈$0.024/s at 480p?), verify via pricing API | |
| Seedance 2.0 Mini | `bytedance/seedance-2.0/mini/{text-to-video,reference-to-video}` | | $0.0721/s 480p; $0.1547/s 720p | |
| Seedance 2.5 | `bytedance/seedance-2.5/text-to-video` (+ edit/extend) | token-billed | $0.0214/1k tokens ≈ $0.473/s 720p, $0.2205/s 480p | |
| Seedance 1.5 Pro | `fal-ai/bytedance/seedance/v1.5/pro/{text,image}-to-video` **[M]** | | verify | |
| MiniMax Hailuo 2.3 | `fal-ai/minimax/hailuo-2.3/{standard,pro}/image-to-video`, `.../hailuo-2.3-fast/standard/image-to-video` | duration 6/10, 768p/1080p | pro $0.49/video; fast $0.19 (6 s) / $0.32 (10 s) | |
| MiniMax H3 / H3 Max | `minimax/h3/image-to-video` (+text), `minimax/h3-max/...` **[M]** | 2K, native audio | H3 $0.13/s (2K; other snippets $0.26/s), verify | H3 Max is fal-post-trained |
| Wan 2.6 | `wan/v2.6/{text-to-video,image-to-video,reference-to-video}` | | $0.05/s (480p) to resolution tiers | note owner prefix `wan/` |
| Wan 2.7 | `fal-ai/wan/v2.7/{text-to-video,image-to-video,reference-to-video,edit-video}` | 15 s, native audio, first/last frame | $0.10/s | |
| Wan 3.0 / 3.0 Prime | `alibaba/wan-3.0/{text-to-video,image-to-video,reference-to-video}` | up to 30 s 1080p, audio | $0.05/0.10/0.20 per s (480p/720p/1080p); Prime $0.068/0.14/0.28 | shipped ~2026-08-24 |
| LTX-2 / 2.3 / 2.5 | `fal-ai/ltx-2/text-to-video` (`/fast`), `fal-ai/ltx-2.3/{text,image}-to-video(/fast)`, `fal-ai/ltx-2-19b/...` | | fast $0.04/s 1080p; pro $0.06 (i2v)/$0.08 (t2v) per s; quality per-MP | open weights |
| Hunyuan Video 1.5 | `fal-ai/hunyuan-video-v1.5/{text,image}-to-video` | | $0.075/s | v1 `fal-ai/hunyuan-video` $0.40/video |
| Sora 2 / Sora 2 Pro | `fal-ai/sora-2/text-to-video`, `.../text-to-video/pro`, `.../image-to-video(/pro)` | 720p/1080p, ≤25 s (pro) | $0.30/s 720p; $0.50/s 1080p (pro) | OpenAI sunset risk **[T]** |
| Grok Imagine Video | `xai/grok-imagine-video/{text-to-video,image-to-video,edit-video}` | 480p/720p | $0.05/s 480p; $0.07/s 720p; edit 6 s 480p $0.36 | v1.5 live Jun 2026 |
| Luma Ray 3.2 | `luma/agent/ray/v3.2/{image-to-video,video-to-video}` | 540p/720p/1080p | 5 s i2v $0.15/$0.30/$1.20; v2v $0.72/$1.08/$2.16 | Ray 2: `fal-ai/luma-dream-machine/ray-2` |
| PixVerse v5 / v5.5 | `fal-ai/pixverse/v5.5/{text,image}-to-video`, `/effects`, `fal-ai/pixverse/lipsync` | | 5 s: $0.15 (≤540p), $0.20 (720p), $0.40 (1080p); lipsync $0.04/s | |
| Vidu Q2 | `fal-ai/vidu/q2/image-to-video/pro` | 720p/1080p | $0.10 + $0.05/s (720p); $0.30 + $0.10/s (1080p) | |
| Gemini Omni Flash 1.1 | `google/gemini-omni-flash/v1.1/{text-to-video,edit}`, `google/gemini-omni-flash/image-to-video` | token-billed | $1.875/M in, $21.875/M out ≈ $0.125/s 720p | Higgsfield `gemini_omni_flash_1_1` |
| Runway Gen-4 / Aleph | not found on fal (Runway API direct: Aleph 15 credits/s ≈ $0.15/s) | | | use Runway API or Kie |

### 6.5 Reference/character-consistent & video editing
| capability | endpoint_id | price | notes |
|---|---|---|---|
| Kling elements / multi-shot | same `v3` endpoints with `elements[]`, `multi_prompt[]` | included in per-second rate | element binding needs `character_orientation="video"` on motion-control |
| Kling motion control | `fal-ai/kling-video/v3/{standard,pro}/motion-control`, `.../v2.6/{standard,pro}/motion-control` | v2.6 std $0.07/s, pro $0.112/s; v3 similar | Higgsfield `motion_control` |
| Seedance reference-to-video | `bytedance/seedance-2.0/reference-to-video` (up to multiple image/video/audio refs) | as above | Higgsfield `omni_reference` |
| Wan reference / edit | `fal-ai/wan/v2.7/reference-to-video`, `fal-ai/wan/v2.7/edit-video` | $0.10/s | 2-10 s source video |
| Wan Animate | `fal-ai/wan/v2.2-14b/animate/...` **[M]** | verify | |
| Kling O3 video edit | `fal-ai/kling-video/o3/pro/video-to-video/edit` | $0.112-0.14/s | |
| Luma modify / reframe | `fal-ai/luma-dream-machine/ray-2/modify`, `fal-ai/luma-dream-machine/ray-2/reframe`, `.../ray-2-flash/reframe` | verify | Higgsfield `reframe` |
| SAM 3 video segmentation | `fal-ai/sam-3/video`, `/video-rle`, `fal-ai/sam-3-1/video` | $0.005 per 16 frames | Higgsfield `sam_3_video` |
| Bria video background removal | `bria/video/background-removal` (+`/realtime`) | $0.14/s (30 s = $4.20); realtime $0.0033/s **[T]** | Higgsfield `video_background_remover` |

### 6.6 Lipsync, talking avatars, dubbing
| capability | endpoint_id | price | notes |
|---|---|---|---|
| sync. lipsync | `fal-ai/sync-lipsync` ($0.70/min), `/v2` ($3/min), `/v2/pro` ($5/min), `/v3` ($8/min) | | Higgsfield `sync_so` = v3 |
| Kling lipsync | `fal-ai/kling-video/lipsync/audio-to-video` (+`text-to-video`) | $0.014 per input video second (5 s increments) | |
| VEED lipsync | `veed/lipsync` ($0.40/min), `veed/lipsync/v2` ($0.07/s) | | |
| VEED Fabric 1.0 (image→talking video) | `veed/fabric-1.0` | $0.08-0.15/s | |
| Creatify Aurora | `creatify/lipsync` **[M]** | $0.10/s 480p, $0.14/s 720p | |
| LatentSync | `fal-ai/latentsync` | $0.20 ≤40 s, then $0.005/s | open weights |
| OmniHuman 1.0 / 1.5 | `fal-ai/bytedance/omnihuman`, `fal-ai/bytedance/omnihuman/v1.5` | $0.14/s, $0.16/s | |
| InfiniTalk | `fal-ai/infinitalk` | $0.20/s (480p), ×2 at 720p | |
| Kling AI Avatar v2 | `fal-ai/kling-video/ai-avatar/v2/{standard,pro}` | $0.0562/s, $0.115/s | |
| ElevenLabs dubbing | `fal-ai/elevenlabs/dubbing` | $0.90/min | Higgsfield `dubbing` (18 langs) |

### 6.7 Video upscaling
| capability | endpoint_id | price |
|---|---|---|
| Topaz video (Starlight etc.) | `fal-ai/topaz/upscale/video`, `topaz/upscale/video/generative` | $0.01/s ≤720p, $0.02/s ≤1080p, $0.08/s >1080p; ×2 at 60 fps; generative 10 s ≈ $1.20-2.60 |
| SeedVR2 video | `fal-ai/seedvr/upscale/video` | $0.001/MP·frame (1080p×121 f ≈ $0.25) |
| ByteDance video upscale | `fal-ai/bytedance-upscaler/upscale/video` | $0.0072/$0.0144/$0.0288 per s (1080p/2K/4K) |
| FlashVSR | not confirmed on fal (WaveSpeed hosts it) | - |
| Generic | `fal-ai/video-upscaler`, `clarityai/crystal-video-upscaler` | verify |

### 6.8 Speech, voice cloning, STT
| capability | endpoint_id | price |
|---|---|---|
| ElevenLabs TTS | `fal-ai/elevenlabs/tts/multilingual-v2` ($0.10/1k chars), `/tts/eleven-v3` ($0.10/1k), `/tts/turbo-v2.5` ($0.05/1k), `/text-to-dialogue/eleven-v3` | |
| MiniMax Speech | `fal-ai/minimax/speech-02-hd` ($0.10/1k), `/speech-02-turbo` (~$0.03/1k), `/speech-2.8-turbo`, `/speech-2.8-hd`, `/preview/speech-2.5-turbo`; clone `fal-ai/minimax/voice-clone` | |
| Qwen3-TTS | `fal-ai/qwen-3-tts/text-to-speech/{0.6b,1.7b}` ($0.07/$0.09 per 1k), `/voice-design/1.7b`, `/clone-voice/{0.6b,1.7b}` | Higgsfield `qwen_audio_tts` |
| Inworld TTS-1.5 Max | `fal-ai/inworld-tts` | $0.005/1k chars (Higgsfield `inworld_text_to_speech`) |
| Kokoro | `fal-ai/kokoro/american-english` (+ other langs) | $0.02/1k |
| Chatterbox / HD | `fal-ai/chatterbox/text-to-speech` ($0.025/1k), `/speech-to-speech`, `resemble-ai/chatterboxhd/text-to-speech` ($0.04/1k) | |
| Dia TTS | `fal-ai/dia-tts`, `/voice-clone` | $0.04/1k |
| Orpheus, F5 | `fal-ai/orpheus-tts`, `fal-ai/f5-tts` | compute-based |
| xAI TTS | `xai/tts/v1` | verify |
| STT | `fal-ai/whisper`, `fal-ai/wizper` (~$0.0005/min), `fal-ai/elevenlabs/speech-to-text` ($0.03/min), `.../speech-to-text/scribe-v2` ($0.008/min) | |
| Seed TTS / Vibe Voice / Cozy Voice | not confirmed on fal, Higgsfield's `text2speech_v2` variants may be direct provider integrations | |

### 6.9 Music and SFX
| capability | endpoint_id | price |
|---|---|---|
| ElevenLabs Music | `fal-ai/elevenlabs/music` | $0.80/min |
| MiniMax Music 2.x | `fal-ai/minimax/music` (+`/v2`, 2.5) | $0.035/generation |
| Lyria 2 / Lyria 3 | `fal-ai/lyria2`, Lyria 3 endpoint | $0.10/30 s; Lyria 3 $0.04/audio |
| Stable Audio 2.5 | `fal-ai/stable-audio-25/text-to-audio` | $0.20/audio (≤190 s) |
| ACE-Step | `fal-ai/ace-step` | $0.0002/s |
| Sonilo | `sonilo/v1.1/text-to-music`, `sonilo/v1.1/video-to-music`, `sonilo/v1.1/video-to-sound-effects` | per generated second (verify), Higgsfield `sonilo_music` |
| Mirelo SFX (video→audio) | `mirelo-ai/sfx-v1/video-to-audio`, `mirelo-ai/sfx-v1.5/video-to-audio` | verify, Higgsfield `mirelo_text_to_audio` |
| ElevenLabs SFX | `fal-ai/elevenlabs/sound-effects/v2` | ~$0.12/min equivalent (credit-based) |
| MMAudio v2 | `fal-ai/mmaudio-v2` (+`/text-to-audio`) | $0.001/s |
| Suno | not on fal (no official API) | - |

### 6.10 3D
| capability | endpoint_id | price |
|---|---|---|
| Hunyuan3D v2 / v2.1 | `fal-ai/hunyuan3d/v2` (+`/turbo`, `/multi-view`), `fal-ai/hunyuan3d-v21` | $0.16/gen (white mesh) |
| Hunyuan3D v3 / v3.1 | `fal-ai/hunyuan3d-v3/{image-to-3d,text-to-3d,sketch-to-3d}`; `fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d` | pro $0.375, rapid $0.225, +$0.15 PBR |
| Trellis / Trellis 2 | `fal-ai/trellis`, `fal-ai/trellis/multi`, trellis-2 | $0.02/gen |
| Tripo | `tripo3d/tripo/v2.5/{image-to-3d,multiview-to-3d}`, `tripo3d/v3.1-...` | $0.20 no texture / $0.30 std / $0.40 HD, +$0.05 style/quad |
| Meshy 6 | `fal-ai/meshy/v6/{text-to-3d,image-to-3d}`, `.../v6-preview/...` | $0.80/gen |
| Rodin | `fal-ai/hyper3d/rodin` (v2, v2.5, `/v2.5/text-to-3d`) | $0.40/gen |
| SAM 3D | `fal-ai/sam-3/3d-objects`, `fal-ai/sam-3/3d-body`, `fal-ai/sam-3/3d-align` | $0.02/gen |
| TripoSR | `fal-ai/triposr` | $0.07 |
| Hunyuan World | `fal-ai/hunyuan_world/image-to-world` | verify |

### 6.11 Training (Soul-like identity)
| capability | endpoint_id | price |
|---|---|---|
| FLUX.1 LoRA fast | `fal-ai/flux-lora-fast-training` (input: images_data_url zip, steps, trigger_word) | $2 per 1000-step run (linear) |
| FLUX.1 portrait / general / turbo | `fal-ai/flux-lora-portrait-trainer` ($0.0024/step, min 1000), `fal-ai/flux-lora-general-training` ($0.005/step), `fal-ai/turbo-flux-trainer` ($2.40/1000 steps) | |
| FLUX.2 [dev] trainer | `fal-ai/flux-2-trainer` | $0.008/step (1000 steps = $8*; snippet said $6.40, verify) |
| Kontext trainer | `fal-ai/flux-kontext-trainer` | verify |
| Z-Image trainer | `fal-ai/z-image-trainer` | verify |
| Wan trainers | `fal-ai/wan-trainer/t2v`, `fal-ai/wan-22-trainer/{t2v-a14b,i2v-a14b}`, `fal-ai/wan-22-image-trainer` | $0.0045-0.005/step (min 100) |
| Krea 2 trainer | `fal-ai/krea-2-trainer` | verify |
| MiniMax H3 LoRA | fal has a "how to train a LoRA for H3" guide → H3 LoRA trainer endpoint | verify |
| Inference with LoRA | `fal-ai/flux-lora` ($0.035/MP), `fal-ai/flux-2/lora` ($0.021/MP), `fal-ai/z-image/turbo/lora` ($0.0085/MP) | |
Seedance/Kling: no LoRA training on fal (closed models).

### 6.12 Vision / video understanding
| capability | endpoint_id | price |
|---|---|---|
| Moondream 3 | `fal-ai/moondream3-preview/{query,caption,detect}` | $0.40/M in, $3.50/M out tokens |
| Any-LLM / vision router | `fal-ai/any-llm`, `fal-ai/any-llm/vision` **[M]**; `openrouter/router` | provider token rates |
| Gemini / Seed LLM | `fal-ai/bytedance/seed/v2/mini` (LLM); Gemini omni endpoints above | |
| SAM 3 image | `fal-ai/sam-3/image`, `/image-rle`, `/image/embed` | verify |

---

## 7. Architecture implications for a Higgsfield-like studio on fal
1. **One transport, many models**: all ~1,000 endpoints share the queue contract, so one worker (submit → webhook → verify ED25519 → fetch result → copy media to own storage) covers every capability. Higgsfield's `medias:[{role,value}]` maps to per-model `*_url` fields, the OpenAPI schema (via `/v1/models?expand=openapi-3.0`) tells you which fields exist, so a role-mapping table per endpoint is the core of your catalog.
2. **Dynamic catalog = `/v1/models` + `/v1/models/pricing` (batched 50) + OpenAPI**; cache 24 h; `thumbnail_url`, `category`, `tags`, `license_type` are enough to render a `models_explore`-style UI; use `q` for search.
3. **Cost preflight** (`get_cost:true` in Higgsfield) = `POST /v1/models/pricing/estimate`; for per-second/per-MP units compute locally from the `unit`.
4. **Retention risk**: 7-day default media expiry and public URLs, always re-host outputs; consider `X-Fal-Object-Lifecycle-Preference` for short-lived intermediates to reduce exposure.
5. **Concurrency is the main scaling lever** (2 → higher with credit purchases; enterprise for guarantees); queue depth per user should be managed on your side since fal never rejects.
6. **Identity ("Soul") feature**: `flux-lora-fast-training` / `flux-2-trainer` (5-20 photos, ~$2-8, minutes) → `fal-ai/flux-2/lora` inference; for video identity use Kling `elements` or Seedance reference-to-video with the LoRA-generated stills.
7. **Presets/workflows**: fal Workflows (`workflows/{owner}/{name}`) can host chained pipelines with streamed intermediate results; otherwise orchestrate in your own worker.
8. **MCP**: mirror fal's discovery tools (`search_models`, `get_model_schema`, `get_pricing`) plus Higgsfield-style task tools; auth with per-user keys via `Authorization: Bearer`.


---

## Fact-check (independent verifier, 2026-09-05)

17 confirmed · 0 refuted · 0 unverifiable out of 17 checked claims.

### Additional findings

## Sourcing caveat
fal.ai, docs.fal.ai, api.fal.ai, queue.fal.run, blog.fal.ai, the Mintlify mirror (fal-d8505a2e.mintlify.app), web.archive.org, hexdocs.pm and hooklistener.com are all blocked by the sandbox egress proxy for both curl and WebFetch. Primary evidence used: fal-js `main` sources (queue.ts, request.ts, config.ts, headers.ts, storage.ts, utils.ts, proxy/index.ts), fal-client 1.0.1 sources (client.py, _headers.py, auth.py), fal CLI keys.py, fal-dart auth.dart, registry.npmjs.org / pypi.org metadata, GitHub code search of independent integrators, and search-engine snippets of official fal pages. Prices are therefore snippet-level; run `GET https://api.fal.ai/v1/models/pricing?endpoint_id=...` before committing to a cost model.

## Endpoint ids / prices seen in 2026 that the claims do not cover
- **Nano Banana 2**: `fal-ai/nano-banana-2` (+`/edit`; alias `fal-ai/gemini-3.1-flash-image-preview`) - $0.08/image base, x0.75 at 512px, x1.5 at 2K, x2 at 4K, +$0.015 with web search. Nano Banana Pro remains $0.15 (4K $0.30).
- **GPT Image 2**: `openai/gpt-image-2` (owner prefix `openai/`) - $0.01 (low, 1024x768) to $0.41 (high, native 4K); `high` is the default quality, so cost defaults to the expensive tier.
- **Seedream 5.0**: Pro `bytedance/seedream/v5/pro/{text-to-image,edit}` ($0.0675 / $0.135 by area), Lite `fal-ai/bytedance/seedream/v5/lite/{text-to-image,edit}` ($0.035 flat, up to ~9 MP).
- **Kling**: 3.0 `fal-ai/kling-video/v3/{standard,pro,4k}/...`, Turbo `v3/turbo/{standard,pro}/...` ($0.112 / $0.14 per s), **O3** `fal-ai/kling-video/o3/{standard,pro,4k}/{text,image}-to-video`, `o3/standard/reference-to-video`, `o3/pro/video-to-video/edit`; 4K is $0.42/s on both v3/4k and o3/4k.
- **Seedance**: 2.0 `bytedance/seedance-2.0/{,fast/,mini/}{text,image,reference}-to-video`; Fast = $0.2419/s (720p only); 2.5 `bytedance/seedance-2.5/{text-to-video,image-to-video,reference-to-video}` token-billed $0.0214/1k tokens (up to 30 s, audio).
- **Veo 3.1**: `fal-ai/veo3.1{,/fast,/lite}` with `/image-to-video`, `/first-last-frame-to-video`, and new `/extend-video` (+`/fast/extend-video`). Lite 720p $0.03/$0.05, 1080p $0.05/$0.08.
- **Wan**: 2.7 `fal-ai/wan/v2.7/*` $0.10/s; 3.0 `alibaba/wan-3.0/{text,image,reference}-to-video` (Aug 2026) $0.05/0.10/0.20 per s, Prime $0.068/0.14/0.28, 30 s 1080p with audio.
- **Ideogram 4** is on fal (fal.ai/ideogram-4): billed per output megapixel $0.03 (Turbo) / $0.06 (Balanced) / $0.10 (Quality) + $0.03 when prompt expansion is used (v3 stays per-image $0.03/$0.06/$0.09).
- **Meta Muse Image** (agentic image gen/edit) launched on fal 2026-09-01 via the 'Meta Model API on fal' (endpoint id not verified).

## Deprecations / changes in 2026
- **Sora 2**: OpenAI deprecated the Sora API on 2026-03-24; every `sora-2` / `sora-2-pro` endpoint returns 410 Gone after **2026-09-24**. Treat fal's `fal-ai/sora-2/*` endpoints as end-of-life; the report's 'sunset risk' is now a hard date.
- **Legacy CDN**: legacy `fal.media/files/<animal>/...` objects not accessed in 6 months were deleted on **2026-06-01**; current CDN paths are `/files/b/...` on v3.fal.media. fal-client 1.0.1 notes the legacy fal.media upload path is disabled (`cdn` repo alias now maps to `fal_v3`).
- **REST host**: SDKs moved from `rest.alpha.fal.ai` to `https://rest.fal.ai` (tokens, storage auth/initiate); the JWKS is referenced at both hosts in the wild - support both.
- **SDKs**: `@fal-ai/client` 1.11.0-alpha.x (Aug 28 / Sep 2 2026) adds a new realtime stack with subpath exports `./realtime`, `./realtime/{ice,wma,lucy,websocket,extension,testing}`; `@fal-ai/server-proxy` 1.3.0-alpha.0 (2026-08-28). Stable lines are still 1.10.1 / 1.2.1. Python `fal-client` 1.0.0 (2026-04-28) -> 1.0.1 (2026-08-19); it also supports `fal auth login` Bearer credentials in addition to `Key`.

## Platform (REST) APIs - verified surface
- `GET /v1/models` - list / find (`endpoint_id`, 1-50) / search (free text, `category`, `status`); `expand=openapi-3.0|enterprise_status`; cursor pagination (`next_cursor`, `has_more`); auth optional (key = higher rate limits).
- `GET /v1/models/pricing` (auth; 1-50 ids) -> `prices[{endpoint_id, unit_price, unit, currency}]`.
- `POST /v1/models/pricing/estimate` - `estimate_type` (e.g. `unit_price`) + endpoints with `unit_quantity`.
- `GET /v1/models/usage` -> items `{endpoint_id, unit, quantity, unit_price, percent_discount, cost_subtotal, cost_discount, cost_total, cost, currency, auth_method}`; filters endpoint/user/date range/auth method.
- `GET /v1/models/analytics`, `/v1/models/requests/payloads` (delete stored payloads + output files), `/v1/workflows`, `/v1/keys` (from docs URLs and the n8n node).
- MCP: `https://mcp.fal.ai/mcp`, Bearer FAL_KEY, 9 tools (`check_job` also cancels/fetches results).

## Webhook verification - concrete steps (docs + 3 independent implementations)
1. Read headers `X-Fal-Webhook-Request-Id`, `X-Fal-Webhook-User-Id`, `X-Fal-Webhook-Timestamp` (unix seconds), `X-Fal-Webhook-Signature` (hex ED25519).
2. Reject if `|now - timestamp| > 300 s`.
3. Fetch JWKS (`https://rest.alpha.fal.ai/.well-known/jwks.json`, also served at `https://rest.fal.ai/.well-known/jwks.json`); cache <= 24 h; each `keys[].x` is a base64url ED25519 public key; try every key.
4. message = `request_id + "\n" + user_id + "\n" + timestamp + "\n" + sha256_hex(raw_body)`; verify with libsodium/PyNaCl.
5. Delivery: `?fal_webhook=` on queue submit; first attempt 15 s timeout, retries 120 s timeout, backoff until the stored result expires (~1 h; ~6 min for results >= 10 KB), max 31 retries -> make handlers fast and idempotent on `request_id`, and fall back to polling `response_url` for large results.

## Result / payload expiry
- CDN media: >= 7 days by default; per-request `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": N|null}` (uploads use `X-Fal-Object-Lifecycle`); account-level default configurable; deleted files are unrecoverable. SDK `expiresIn`: `never|immediate(60 s)|1h|1d|7d|30d|1y|<seconds>` plus `initialAcl` {default, rules[{user, decision: hide|forbid|allow}]}.
- Request payloads: stored 30 days; `X-Fal-Store-IO: 0` to not store; Platform API to delete.
- Webhook-stored results: ~1 h (~6 min if >= 10 KB).

## Upload limits
- Simple CDN upload max 100 MB (docs); fal-js switches to multipart above 90 MB, fal-client above 100 MB; 10 MB parts; Python uses 10 parallel workers. No platform-level file-type restriction; models enforce their own input limits.

## Concurrency and retries
- New accounts: 2 concurrent IN_PROGRESS; auto-scales with paid invoices over the last 4 weeks up to 40 (self-serve); enterprise above that. IN_QUEUE is unbounded and never 429s.
- Server retry controls: `x-fal-no-retry`, `X-Fal-Retry-Config` (`{"server_error":{"retries":n},"timeout":{...},"connection_error":{...}}`). Client-side: fal-js exports `isRetryableError`/`RetryOptions` and retries status polls; fal-client retries up to 10 attempts with exponential backoff capped at 30 s.
- Gotcha: revoking an API key does not free IN_PROGRESS slots (fal-ai/fal issue #939).
