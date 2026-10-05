# Reflow Studio synthesis dossier: an open alternative to Higgsfield

**Date:** 2026-09-05 · **Status:** decision taken and largely implemented · **Audience:** contributors who want to know why the studio is built the way it is.

This dossier condenses the research reports in this directory (`01` to `07`, each with an independent fact-check) and the code that was built from them. Where a fact-check contradicted an original report, the corrected value is used here. Anything that could not be confirmed against a primary source is tagged **(unverified)**. One caveat applies to the whole document: the research sandbox could not reach `fal.ai`, `docs.fal.ai`, `kie.ai`, `docs.kie.ai`, `higgsfield.ai`, `supabase.com`, `vercel.com` or `modelcontextprotocol.io` directly (egress proxy). Provider facts therefore come from official SDK source code, verbatim documentation mirrors on GitHub, npm/PyPI metadata, Higgsfield's public MCP tool list and search-engine snippets of official pages. Prices are list prices seen in July-September 2026 and must be re-fetched (`GET https://api.fal.ai/v1/models/pricing`, Kie `creditsConsumed`) before they enter a cost model.

---

## 1. Executive summary

### 1.1 What Higgsfield really is

Higgsfield (higgsfield.ai) is a product layer, not a model company. Its live catalog on 2026-09-05 lists 95 models (`models_explore action:list`, `has_more:false`); roughly 75 of them are third-party models, Google Nano Banana / Veo / Gemini Omni, OpenAI GPT Image 2, ByteDance Seedream / Seedance, Black Forest Labs FLUX.2, Kling, xAI Grok, Wan, MiniMax, Recraft, Topaz, Meshy, Tripo, Tencent Hunyuan3D, Meta SAM 3, that fal.ai and Kie.ai also host. Three catalog entries (`sonilo_music`, `mirelo_text_to_audio`, `inworld_text_to_speech`) even carry `provider_name: "FAL"`, and Higgsfield's own developer API on `platform.higgsfield.ai` exposes third-party models under fal-style ids such as `bytedance/seedream/v4/text-to-image` and `flux-pro/kontext/max/text-to-image` (https://github.com/higgsfield-ai/higgsfield-js). Higgsfield's proprietary value sits in four layers on top of that resold catalog:

1. **Soul**: an identity-consistent photoreal image family (Soul 2.0, Soul Cinema, Soul Cast, Soul Location) plus "Soul ID" training from 5-20 photos.
2. **Cinema Studio / DoP / presets**: camera-rig prompt systems, an image-to-video motion model ("DoP") behind 63 camera/effect presets, and Cinema Studio 3.0 video whose parameter set is identical to Seedance 2.0's (`genre` enum, 480p-4K ladder, `generate_audio`), consistent with a tuned wrapper **(inference, unverified)**.
3. **Marketing Studio / Ad Multiplier / Genjutsu**: brand-kit extraction, 986 ad presets, avatars, "Ad Multiplier" (explicitly "powered by Seedance 2.5"), and Genjutsu motion-transfer / object-swap (Kling-3.0-based per its own MCP docs).
4. **An agent surface**: a 92-tool remote MCP server with 16 SKILL.md workflows, a sandbox (`sandbox_exec`), a website builder, a 3D scene builder, Shorts Studio, Personal Clipper, a virality predictor and TikTok publishing.

Commercially it is a $5.4B company (Series B, Aug 2026, ~$700M annualised revenue per PR Newswire snippets) selling subscriptions of 270-3,000 credits per month at an effective $0.033-$0.07 per credit, with "unlimited" promotions on selected image models to keep image-heavy users inside the app.

### 1.2 What replacing it takes

Because the upstream for ~85% of the catalog *is* fal.ai or the vendor's official API, replacement is mostly re-plumbing: one queue contract (fal), one secondary reseller for price arbitrage and a few closed models (Kie), a self-describing model catalog with declarative provider bindings, a job pipeline with signed webhooks and a polling safety net, a cost ledger, a studio UI, a REST API and an MCP server that keeps Higgsfield's tool vocabulary. The proprietary layers (Soul, Cinema Studio, Marketing Studio, presets, workflows) are prompt systems and pipelines over the same models; they are approximated, not cloned, and they are phase-2/3 work.

### 1.3 What was built

`packages/core` (`@reflow/core`, 253 Vitest tests) and `apps/web` (Next.js 16, Supabase, Vercel, `mcp-handler` 2):

- A **data-driven catalog** of **38 models** (14 image, 16 video, 8 utility) with **69 provider bindings** (40 fal, 29 Kie), covering **43 of Higgsfield's 95 catalog ids**; bindings are data, not code.
- **Provider adapters** for fal (queue API, ED25519/JWKS webhook verification, storage upload, Platform APIs) and Kie (jobs and Veo envelope families, opt-in HMAC webhook verification), plus a mock provider for offline development.
- `normalizeRequest` (Higgsfield-style `adjustments`), `estimateCost` (per image / megapixel / second / generation / 1k chars with parameter modifiers), `ProviderRouter` (`preferred` | `cheapest` | `quality`, fallback on infrastructure errors).
- A Supabase schema (`0001_init.sql`): `workspaces`, `workspace_members`, `profiles`, `generations`, `generation_outputs`, `media_assets`, `folders`, `elements`, `api_keys`, `ledger_entries` (+ `ledger_balances` view), `provider_events`, RLS, private buckets, realtime broadcast; `0002_reconcile_cron.sql` for a `pg_cron` + `pg_net` reconciler.
- `StudioService` (create → reserve → submit → webhook/poll → copy to storage → settle), a REST API (`/api/v1/models|generations|estimate|media|balance`, `/api/webhooks/{provider}`, `/api/internal/reconcile`), a 12-tool MCP server at `/api/mcp` with `rfl_` API-key auth, and the studio UI (create image/video with model picker, media slots and live cost; results feed; library; assets; models; usage; API keys).
- A `catalog:verify` / `catalog:prices` script that diffs bindings against fal's per-endpoint OpenAPI and pricing APIs, written but **not yet run**, because no provider was reachable from the sandbox. Every binding is therefore `verified: false`.

### 1.4 Headline economics

Higgsfield credits convert to USD at $0.033 (Ultra annual) to $0.05 (top-up / auto-refill), list price is $0.085, so a Higgsfield price is quoted below as a range. fal and Kie figures are the fact-checked list prices (§3.5 has the full table with sources).

| Generation | Higgsfield (credits → USD) | fal.ai list | Kie.ai list |
|---|---|---|---|
| Nano Banana Pro, 1 image, 2K | 2 cr → $0.07-0.10 (or $0 in a 7-day unlimited window) | $0.225 ($0.15 at 1K) | $0.09 |
| Nano Banana 2, 1 image, 1K | 1.5 cr → $0.05-0.075 | $0.08 | $0.04 |
| GPT Image 2, 1 image, 2K high | 7-8.5 cr → $0.23-0.43 | ≈$0.01 (low) … $0.41 (high 4K), token-billed | $0.05 |
| Seedream 5 Pro, 1 image ≤1536² | not captured | $0.0675 | $0.035 |
| FLUX.2 Pro, 1 image, 1 MP | 0 cr on Ultra (365-day unlimited) | ≈$0.03-0.045 | $0.025 |
| Kling 3.0 std, 5 s, silent | 5.25-6 cr → $0.17-0.30 | $0.42 | $0.35 |
| Kling 3.0 pro, 5 s, audio | 17.5-20 cr → $0.58-1.00 | $0.84 | $0.675 |
| Seedance 2.0, 720p, 5 s | 22 cr → $0.73-1.10 | $1.52 | $1.03 |
| Veo 3.1 Fast, 8 s | 40 cr → $1.32-2.00 | $0.80 (silent) / $1.20 (audio) | $0.30 |
| Topaz image upscale | 2 cr → $0.07-0.10 | $0.08 per 24 MP | $0.02 (unverified) |

The honest reading: Higgsfield is *not* uniformly more expensive. On images it is at or below fal list price (negotiated rates plus unlimited promotions that make several image models free to subscribers). The own studio wins on **video** (Veo 3.1 Fast 4-7× cheaper via Kie, Kling and Seedance 1.2-2× cheaper), on **seats** (no per-seat subscription; the API and MCP draw from the same ledger at cost), on **expiry** (Higgsfield top-ups expire after 90 days and subscription credits do not roll over), and on **control** (own storage, own catalog, no trial/unlimited mechanics, no vendor churn decided for you). §9 works this into a break-even.

### 1.5 Effort estimate for the remaining phases

| Phase | Scope | Estimate (engineer-weeks) |
|---|---|---|
| 1 (finish MVP) | Vercel Pro + Supabase Pro deployment, first live runs against fal and Kie, run `catalog:verify`/`catalog:prices`, fix mapping mismatches, flip `verified`, enable Kie HMAC, `pg_cron` reconciler, smoke tests | 1-2 |
| 2 (parity) | Elements (`<<<uuid>>>`), characters via LoRA training, 62 presets as templates, one-click utilities, batch + pipelines (Vercel Workflow or Inngest), audio (TTS/clone/lipsync/music), realtime UI, OAuth 2.1 via Supabase, optional MCP Apps widget | 8-12 |
| 3 (product layers) | Workflow library as MCP prompts/resources, marketing chains with sandbox assembly, video analysis/clips, 3D, multi-tenant + Stripe | 10-16 |

One engineer: roughly five to seven months to full parity-plus; two engineers: about three months. Phase 1 should be finished before anything else is started, because every later phase depends on verified bindings.

### 1.6 The five conclusions

1. Higgsfield is a reseller with a prompt-engineering moat; ~85% of its catalog is reachable on fal.ai under one queue contract, and the rest of its value is prompt engineering in guided workflows, which an open studio has to write from scratch.
2. fal primary, Kie secondary behind a router is the right shape: fal for reliability, schemas, signed webhooks and breadth; Kie for 1.5-4× cheaper closed models (Veo, Seedance, Kling, GPT Image 2, Nano Banana) with explicit ToS and drift risk.
3. The economic case rests on video volume, seat count and ownership, not on per-image price; an image-only single user is served cheaper by Higgsfield's unlimited promos.
4. The built architecture (data-driven catalog, webhook-first + poll-on-read, copy-to-storage, ledger with reservations, API-key MCP) is correct for a single-tenant MVP on Vercel + Supabase, but nothing is production-proven until the bindings are verified live and the first cheap runs go through `provider_events`.
5. MCP should stay at ≤15 tools with Higgsfield's vocabulary, API keys first, Supabase OAuth 2.1 second (needed for individual Claude.ai users), MCP Apps as a later progressive enhancement; the tasks extension is not usable in hosts yet, so jobs stay application-level handles.

---

## 2. Higgsfield anatomy

### 2.1 UI surfaces

Higgsfield's own website-category list (`list_website_categories`) is the best map of the product: Viral Trends (effects/presets), Ads & Marketing (Marketing Studio, URL-to-Ad, Ad Reference), UGC & Social (Shorts Studio, Personal Clipper, Explainer), Cinematic (Cinema Studio, Originals, storyboard), Characters & Avatars (Soul ID, Photodump, Face Swap, Character Swap), Product & E-commerce, Portrait & Lifestyle. The surfaces a replacement needs to know about (details in `06-higgsfield-product.md` §1):

- **Create Image / Create Video**: prompt, model picker, aspect-ratio chips (1:1 … 21:9, `auto`), resolution/quality, reference slots per model (up to 14 refs on Nano Banana Pro/2, GPT Image 2; a `mask` slot on Nano Banana 2; start/end frames and reference video/audio slots on video models), batch count 1-4, credit cost printed on the Generate button, results in a masonry history grid polled every 3-4 s.
- **Studios and layers**: Soul / Soul ID (trained identity, 25 credits per training, usable only with `soul_2`/`soul_cinematic`); Cinema Studio (camera body, lens, focal length, aperture, sensor profile, global look, per-shot moves); Marketing Studio / DTC Ads (brand kit from a URL, products, 40+ avatars, 986 presets, hooks/settings, ad-reference analysis, Ad Multiplier); Popcorn storyboards; Canvas node graph; 63 presets/effects/camera controls; Genjutsu (launched 2026-09-01); Lipsync / Audio; Characters / Elements (`@name` references); Upscale / Enhance; Explore feed; Assets / Folders / Workspaces; Apps marketplace; Website / App builder; Supercomputer (agent with sandbox); Shorts Studio (44 presets); Clipify / Personal Clipper; Virality Predictor; TikTok publishing; 3D scene builder.

Twenty screens are enumerated in `06-higgsfield-product.md` §1.2. The MVP reproduces the first one (generate panel + results grid + assets + library + usage + keys) and deliberately nothing else.

### 2.2 The 92-tool MCP surface

At the time of research Higgsfield's public MCP server listed 92 tools. Grouped:

| Group | Tools |
|---|---|
| Generation | `generate_image`, `generate_video`, `generate_audio`, `generate_{image,video,audio}_batch`, `generate_3d`, `motion_control` |
| Jobs and results | `jobs_wait`, `job_display`, `show_generations`, `show_generation_by_ids`, `show_medias` |
| Media | `media_upload`, `media_confirm`, `media_import_url`, `media_upload_widget` |
| Catalog and presets | `models_explore`, `presets_show`, `get_explainer_presets`, `resolve_explainer_preset`, `animation_actions` |
| Utilities | `upscale_image`, `upscale_video`, `reframe`, `remove_background`, `outpaint_image` |
| Voice | `list_voices`, `create_voice`, `create_voice_from_confirmed_audio`, `voice_change`, `dubbing` |
| Elements, characters, marketing | `show_reference_elements`, `show_characters`, `show_marketing_studio_v2`, `show_marketing_studio_generations` |
| Workflows and sandbox | `get_workflow_instructions`, `sandbox_exec` |
| Website builder | `create_website`, `deploy_website`, `publish_website`, `rename_website`, `list_websites`, `list_website_categories`, `website_status`, `website_db`, `website_secrets`, `website_repo_access` |
| 3D scene builder | 12 `scene_builder_3d_*` tools |
| Social | 8 `tiktok_*` tools, 5 `shorts_studio_*`, 3 `personal_clipper_*`, 3 `video_analysis_*`, `virality_predictor` |
| Apps | `apps_search`, `apps_describe`, `apps_invoke` |
| Account | `balance`, `transactions`, `show_plans_and_credits`, `cancel_trial_auto_renewal`, `list_workspaces`, `select_workspace`, `participate_in_contest` |

The runtime contract, as visible in the public tool descriptions: `generate_*` take `params:{model, prompt, aspect_ratio, duration, count 1-4, medias:[{role, value}], get_cost, use_unlim, …}`; `value` is a `media_id` **or a completed job id** ("Do not pass https:// URLs"); `get_cost:true` returns credits without submitting; the server reports `adjustments` when it clamps; batches take ≤12 requests with caller-supplied `index`; `jobs_wait` takes ≤12 jobs, `timeout_seconds` max 15, and returns `all_terminal` + `poll_after_seconds`; a `recovery_tool` is returned on typed failures; `unlim_choice` means "no job submitted, ask the user". The whole input abstraction is "media_id-or-job_id plus role"; the built studio adopts it 1:1 (ADR-008).

### 2.3 Model catalog by class (95 entries)

From `_catalog_list_page1.json` (95 items): about 20 Higgsfield-branded entries (Soul 2/Cinema/Cast/Location, Cinema Studio 2.5/3.0/video, Marketing Studio image/video, `ms_image`, Ad Multiplier, Genjutsu `hf_mult_*`, Personal Clipper, AutoSprite, `higgsfield_preset`, `text2speech_v2`, `image_auto`); 10 Google (Nano Banana family, Veo 3/3.1/3.1 Lite, Gemini Omni); 2 OpenAI (GPT Image 2 and "Hazel", its arena codename); 10 ByteDance (Seedream 4.5/5, Seedance 1.5/2.0/2.0 Mini/2.5, Seed Audio, upscalers); 4 Kling; 4 BFL (FLUX.2, outpaint, Kontext, FLUX 3 Video); 4 xAI; 4 Wan; 3 MiniMax; Recraft, Z-Image, Happy Horse, Qwen TTS; 3 tagged `FAL`; 3 Meta SAM 3; 7-8 Meshy; Tripo; Hunyuan3D; and about ten utility rows without a provider (background removers, Sync Lipsync 3, outpaint, Topaz, video upscale, deflicker). Aliases: `soul_2` == `soul_v2`; `ad_multiplier` schema == `seedance_2_5`.

Every catalog row is a self-describing object, `{id, name, provider_name, output_type, parameters[{name, required, type, options, default, min, max}], medias[{roles[], max}], aspect_ratios[], durations|duration_range, tags[], supports_unlim, unlim}`, which is exactly the shape `ModelDefinition` in `packages/core/src/catalog/types.ts` mirrors. Its `models_explore action:recommend` is a keyword/tag scorer with hard-coded intent boosts (+1200 for "marketing" on any product intent); a curated intent → model table is what actually drives quality in the workflows.

### 2.4 The 16 workflows

Higgsfield lists 16 guided workflows (ads, product photoshoots, thumbnails, faceless and UGC-style video, subtitles, video editing and others). They are not server-side pipelines: the MCP server hands the agent written instructions, the agent asks the user a few intake questions, calls fixed models in a fixed order and checks the results with small scripts in a sandbox. The value is in the prompt writing and the quality checks. Reflow Studio does not ship these workflows; any future workflow library in this repository will be written from scratch (see phase 3).

### 2.5 Presets

`presets_show` returns 63 presets in two families (`job_set_chain_preset` such as EARTH ZOOM, ORBIT 360, STICKER PEEL; `superhero-gen-preset` such as Earth zoom in/out, Disintegration); the `higgsfield_preset` model takes `preset_id` plus one image (16:9 / 9:16 / 1:1). DoP, Higgsfield's image-to-video motion model, sits behind the camera presets (also sold through WaveSpeedAI as `higgsfield/dop` from $0.125 per 5-second video, snippet). `get_explainer_presets` returns 22 style cards for faceless video; Marketing Studio has 986 presets; Shorts Studio 44.

### 2.6 Billing, credits, unlimited

Plans as listed on 2026-09-05: Free $0 (watermark, no commercial rights); Starter $19/month, 270 credits, 2 video / 4 image concurrency; Plus $59/month ($47 annual first year), 1,200 credits; Ultra $129/month ($99 annual), 3,000 credits, 8 video / 8 image concurrency, "all models & features", Supercomputer 5 GB and 10 scheduled jobs. Team/Business ladders ($62-79 per seat, pooled credits) appear in snippets and conflict with a "Basic/Pro/Max" ladder, **(unresolved)**. Top-ups: 500 credits $29.41 … 4,000 credits $210.53 ($0.0526-0.0588 per credit), expiring after 90 days; auto-refill 20 credits per $ ($0.05). Subscription credits are zeroed at renewal. "Unlimited" is a retention mechanic: 365-day unlimited on Seedream 5 Lite, FLUX.2 Pro 1K, Seedream 4.5, Nano Banana, Kling O1 Image and GPT Image; 5,000-10,000 free Soul V2 gens; 7-day unlimited on Nano Banana Pro/2 (annual Ultra adds Kling 3.0 720p/5 s). Observed per-generation credits (2026): Nano Banana Pro 2, Nano Banana 2 1.5, GPT Image 2 7-8.5, Seedream 4.5 1, Topaz image 2, Kling 3.0 5.25-90 by tier, Seedance 2.0 36-165, Seedance 2.5 75, Veo 3 58, Veo 3.1 Lite 8, Gemini Omni Flash 30, Marketing Studio video 40, Soul ID training 25.

### 2.7 Proprietary vs resold: the evidence

Proprietary by Higgsfield's own claim: "the Soul family, DOP, Cinema Studio, Keyframes, Soul ID and Soul HEX" (snippet). Resold, by `provider_name` in the live catalog: everything else, including explicit `FAL` tags on three entries, "Ad Multiplier, powered by Seedance 2.5" in the tool text, "MiniMax H3 Max post-trained by fal" (snippet), Shorts Studio "powered by Gemini Omni Flash" (snippet), Genjutsu routed to Kling 3.0 motion control per the public tool descriptions, and the fal-style ids in Higgsfield's own SDK. WaveSpeedAI hosts `higgsfield/soul` image-to-image at $0.09/run and Segmind hosts Soul with 70+ styles (snippets), which is how an *exact* Soul look could be obtained without a Higgsfield subscription if ever required.

---

## 3. Provider landscape

### 3.1 fal.ai (primary)

- **Auth:** `Authorization: Key <FAL_KEY>` on every call; key scopes `ADMIN` / `API`; short-lived JWTs (`POST rest.fal.ai/tokens/`) for browser/realtime use. (fal-js `request.ts`, fal-client `client.py`; https://docs.fal.ai/reference/platform-apis/authentication)
- **Job lifecycle:** `POST https://queue.fal.run/{endpoint}` (optional `?fal_webhook=`) → `{request_id, status_url, response_url, cancel_url}`; `GET …/status` (`IN_QUEUE | IN_PROGRESS | COMPLETED`, `queue_position`, logs); `GET …` for the result; `PUT …/cancel`. Always use the URLs returned by submit (nested ids resolve on the root app id). (https://docs.fal.ai/model-apis/model-endpoints/queue)
- **Webhooks:** payload `{request_id, gateway_request_id, status: OK|ERROR, payload, error, payload_error}`; headers `X-Fal-Webhook-Request-Id`, `-User-Id`, `-Timestamp`, `-Signature` (hex **ED25519**); message = `request_id\nuser_id\ntimestamp\nsha256_hex(body)`; JWKS at `https://rest.alpha.fal.ai/.well-known/jwks.json` and `https://rest.fal.ai/.well-known/jwks.json` (support both; cache ≤24 h; try every key); reject `|now − ts| > 300 s`. Delivery: 15 s first attempt, then retries with backoff until the stored result expires (~1 h, ~6 min for results ≥10 KB), up to 31 retries, handlers must be fast and idempotent on `request_id`. (https://docs.fal.ai/model-apis/model-endpoints/webhooks; three independent verifier implementations agree)
- **Storage / expiry:** generated media stays on the CDN ≥7 days by default on public URLs; per-request `X-Fal-Object-Lifecycle-Preference: {"expiration_duration_seconds": N|null}`; request payloads stored 30 days (`X-Fal-Store-IO: 0` to opt out); legacy `fal.media` objects were purged on 2026-06-01. Upload: `POST rest.fal.ai/storage/upload/initiate` → PUT; multipart above 90-100 MB.
- **Schemas / Platform APIs:** `GET https://api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0` returns the model plus `components.schemas.{Input,Output}`; `/v1/models/pricing` (≤50 ids → `unit_price`, `unit`), `/v1/models/pricing/estimate`, `/v1/models/usage`; every model page also serves `llms.txt`. (n8n-nodes-fal, thorwhalen/falaw)
- **SDK quality:** `@fal-ai/client` 1.10.1, `@fal-ai/server-proxy` 1.2.1, Python `fal-client` 1.0.1, typed endpoint maps, official MCP at `https://mcp.fal.ai/mcp` (9 tools). Excellent.
- **Pricing model:** output-based per endpoint, per image, per megapixel (input + output, rounded up), per second (× resolution × audio), per 1,000 characters, per minute, per generation, per training step, per token for some models, and per compute-second for a few (H3, Wan 3.0 by one source). Prepaid credits; no self-serve hard spend cap found, implement your own.
- **Concurrency / limits:** new accounts 2 concurrent `IN_PROGRESS`, auto-scaling with paid invoices over the last 4 weeks up to 40 self-serve, enterprise above; `IN_QUEUE` is unbounded and never returns 429. Server-side retry controls `x-fal-no-retry`, `X-Fal-Retry-Config`. Gotcha: revoking a key does not free `IN_PROGRESS` slots (fal-ai/fal issue #939).
- **Reliability / ToS:** official vendor partnerships (Google, OpenAI, ByteDance, Kling, BFL, xAI, ElevenLabs …), a status page, Trust & Safety + AUP; customers own outputs within each upstream model's licence (`metadata.license_type` in the catalog). (https://fal.ai/legal/terms-of-service)
- **Deprecations:** OpenAI removed the Sora API on 2026-03-24 with every `sora-2*` endpoint returning 410 after **2026-09-24**; treat `fal-ai/sora-2/*` as end-of-life.

### 3.2 Kie.ai (secondary)

- **Auth:** `Authorization: Bearer <KIE_API_KEY>`; parent/sub keys with hourly/daily/total caps and IP allow-lists; body code **433** when a sub-key cap is hit. Base `https://api.kie.ai`; uploads on a separate host `https://kieai.redpandaai.co`. (docs.kie.ai mirror in hassanvfx/kie-api-python)
- **Job lifecycle:** three envelope families. (a) Unified jobs: `POST /api/v1/jobs/createTask {model, input, callBackUrl}` → `data.taskId`; `GET /api/v1/jobs/recordInfo?taskId=` → `state ∈ waiting|queuing|generating|success|fail`, **`resultJson` is a JSON string** → `{resultUrls[]}`, `failCode`, `failMsg`, `costTime`. (b) Veo: `POST /api/v1/veo/generate` (`model veo3|veo3_fast|veo3_lite`, `generationType`, `imageUrls`), `GET /api/v1/veo/record-info` with `successFlag 0/1/2/3`, `resultUrls`, `creditsConsumed`; 1080p/4K via separate upgrade calls. (c) Suno, GPT-4o Image, Flux Kontext, Runway, Midjourney with their own `successFlag`-style envelopes. **The JSON body `code` is the real status; HTTP 200 with `code != 200` is an error.**
- **Webhooks:** `callBackUrl` per task; 15 s timeout; stop after 3 consecutive failures; the same `taskId` may be delivered more than once. Signing is **opt-in** ("when you enable the webhookHmacKey feature in the settings page"): `X-Webhook-Timestamp`, `X-Webhook-Signature = base64(HMAC-SHA256(taskId + "." + timestamp, key))`; payloads use `data.taskId` or `data.task_id` depending on family, normalise both; no replay window is specified, enforce your own.
- **Storage / expiry:** results deleted after **14 days** (one page says 24 h), `POST /api/v1/common/download-url` gives a **20-minute** signed link; uploads auto-delete after 3 days (24 h on another page); result hosts `tempfile.aiquickdraw.com` / `file.aiquickdraw.com`. Uploads: base64 (≤10 MB), URL (≤100 MB), multipart stream; Cloudflare rule 1010 returns 403 to bot-like User-Agents. Some models accept `asset://{assetId}` references.
- **Schemas / SDK:** no official SDK, OpenAPI file or MCP; Mintlify docs (`https://docs.kie.ai/llms.txt`) with per-page fragments. Field naming is mixed (`callBackUrl`, `aspect_ratio` vs `aspectRatio`, `imageUrls` vs `image_urls` vs `image_input`); one Seedance 2.0 doc key is literally `"reference_video_urls "` with a trailing space; `multi_shots` became required on `kling-3.0/video` without a doc bump; Kling naming forked (`kling-3.0/video`, `kling-3.0-omni/*`, `kling/v3-turbo-*`). Community servers (`@felores/kie-ai-mcp-server` 5.x, `elibarnett/kie-mcp` 5.1.0 with a weekly drift-watch) are the best machine-readable catalog, pin versions.
- **Pricing:** credits at **$0.005**; packs $5-$200, +10% bonus above $1,250; credits never expire; 80 free credits; "failed tasks are not charged" (community disputes 501 cases); no cost-preflight endpoint, `creditsConsumed` after completion, and not on every family. Prices drift monthly (Veo 3 Fast 80 → 60 credits; Wan 2.5 3 → 12 cr/s; Seedance 2 Mini cut sharply on 2026-08-26; Seedance 2.5 launched unpriced in July).
- **Rate limits / concurrency:** **20 task creations per 10 s per account**, excess gets 429 and is *not* queued; "no strict concurrency limit", 100+ concurrent tasks typical. Balance: `GET /api/v1/chat/credit`.
- **Reliability / ToS:** operated by NEXUSAI SERVICES LLC with INNOLEAP AI LLC (a defendant in *Robbins Research International v. InnoLeap AI LLC*, S.D. Cal., 2025); self-declared "stability may be slightly lower than official providers"; support hours UTC 21:00-17:00; no status page. It is an **unofficial reseller** for at least Google (Veo errors reference "rejected by Flow", the consumer app), OpenAI Sora, Suno (no public API exists; Suno announced a curated partner program in July 2026) and Midjourney (pulled at Midjourney's request in 2025 per reviews, yet still documented and wired, **gray**). Sora slugs disappear on **2026-09-24** with no announced replacement. Per-model `nsfw_checker` defaults to **false** on several models.

### 3.3 Direct vendor APIs

Used only for real gaps: the **ElevenLabs official API** for voice management (cloning, voice library, dubbing at $0.33-0.50/min; API access reportedly needs the Pro plan) and the **Google Gemini API** for video understanding, virality rubrics, prompt rewriting and routing (~300 tokens per second of video). Optional, behind feature flags: WaveSpeedAI or Higgsfield's platform API for exact Soul/DoP, sync.so for lipsync-3 at API price, Meshy/Tripo official where fal lacks a mode. A sandbox provider (E2B, Modal, or Vercel Sandbox at $0.128/vCPU-h) with ffmpeg/ImageMagick/whisper/playwright replaces `sandbox_exec` in phase 3.

### 3.4 Side by side

| Dimension | fal.ai | Kie.ai |
|---|---|---|
| Contract | one queue API for ~1,000-1,500 endpoints | three envelope families, per-model quirks |
| Webhook security | ED25519 + JWKS, always on | HMAC-SHA256, opt-in in settings |
| Result retention | ≥7 days public URLs, configurable | 14 days / 24 h, 20-min signed links |
| Schemas | per-endpoint OpenAPI + typed SDKs | Markdown pages, no SDK |
| Cost preflight | `/v1/models/pricing(/estimate)` | none; `creditsConsumed` post hoc |
| Rate limiting | queue, never 429 | 20 creates / 10 s, 429 |
| Vendor posture | official partnerships | unofficial reseller, gray models |
| Price | list | typically 30-75% lower on closed models |
| Unique | LoRA trainers, 3D, video matting/reframe, SAM 3, Luma, sync-lipsync, Sonilo/Mirelo/Inworld | Suno, Kling AI Avatar, OmniHuman 1.5, InfiniTalk, Runway Aleph, Ideogram character/reframe, Wan 2.2 Animate, Kling O3 "transformation" |

### 3.5 Price comparison (fact-checked list prices, Aug-Sep 2026)

| Model / job | fal.ai | Kie.ai | Note |
|---|---|---|---|
| Nano Banana 2 (1K / 2K / 4K) | $0.08 / $0.12 / $0.16 (+$0.015 web search) | $0.04 / $0.06 / $0.09 | Kie ½ of fal |
| Nano Banana Pro (1K / 2K / 4K) | $0.15 / $0.225 / $0.30 | $0.09 / $0.09 / $0.12 | Kie image prices drift monthly |
| GPT Image 2 | token-billed; ≈$0.01 (low, 1024×768) → $0.41 (high, native 4K); `high` is the default | $0.03 / $0.05 / $0.08 (1K / 2K / 4K) | Kie by far cheapest at high quality |
| Seedream 5 Pro | $0.0675 (≤1536²) / $0.135 (≤2048²); edit +$0.0045 per extra input | $0.035 (1K/1.5K) / $0.07 (2K), +$0.0025 per extra input | fal bills opaque "units"; a 1024² call was charged $0.135 |
| Seedream 5 Lite | $0.035 flat | ≈$0.025-0.0275 | |
| FLUX.2 pro / flex / max | $0.03 + $0.015/MP · $0.05/MP · $0.07 + $0.03/MP | $0.025-0.035 · $0.02 ·, | no max on Kie |
| Kling O1 image | $0.028 | - | absent from Kie's 122-model catalog |
| Kling 3.0 std / pro, per s | $0.084 / $0.126 (audio) · $0.112 / $0.168 · 4K $0.42 | $0.07 / $0.10 · $0.09 / $0.135 · 4K $0.335 | Kling O3 on Kie 14-67 cr/s |
| Kling 3.0 motion control, per s | $0.112 (pro) | $0.10 (720p) / $0.135 (1080p) | |
| Seedance 2.0, per s | 720p $0.3034, 1080p $0.682; Fast $0.2419 (720p only); Mini 480p $0.0721, 720p $0.1547 | 480p $0.095, 720p $0.205, 1080p $0.51, 4K $1.04 (lower with video input); Mini 720p $0.041 | |
| Seedance 2.5, per s | $0.0214/1k tokens ≈ $0.2205 (480p), $0.473 (720p) | 480p $0.14 ($0.085 with video), 720p $0.315 ($0.19), 1080p $0.57 ($0.3425) | like-for-like Kie ≈1.5-2× cheaper (corrected from "3-5×") |
| Veo 3.1 std / fast / lite, per s | $0.20 / $0.40 audio · $0.10 / $0.15 · lite 720p $0.03 / $0.05, 1080p $0.05 / $0.08 | per 8 s: $1.25 / $0.30 / $0.15 (720p) | Kie fast rate card 60 cr; an earlier empirical read of 168 cr ($0.84) conflicts (unverified) |
| Wan 2.7, per s | $0.10 | $0.08 (720p) / $0.12 (1080p) | |
| Wan 3.0, per s | $0.05 / $0.10 / $0.20 (480p/720p/1080p), Prime $0.068 / $0.14 / $0.28, another source says per compute-second (unverified) | $0.04 / $0.08 / $0.16, billed on input + output duration | |
| MiniMax H3, per s | per compute-second (unverified) | $0.08 (768p) / $0.13 (2K), +≈$0.04 per ref image after the first five | |
| Grok Imagine video, per s | $0.05 (480p) / $0.07 (720p) | $0.012 / $0.0225 / $0.04 | Kie ≈3× cheaper |
| Gemini Omni Flash 1.1, per s | $0.03 / $0.10 / $0.15 / $0.30 (360p-4K) | T2V 4 s 720p $0.315 … | fal token billing applies only to the old endpoints |
| Topaz video upscale | $0.10 per 10 s (720p), $0.20 (1080p), $0.60 (4K) precision | $0.04/s (1-2×), $0.07/s (4×) | |
| ByteDance video upscale, per s | $0.0072 / $0.0144 / $0.0288 (1080p/2K/4K) | - | cheapest upscaler |
| ElevenLabs TTS, per 1k chars | $0.10 (v3, multilingual v2), $0.05 (turbo) | $0.06 (multilingual v2), $0.03 (turbo) | |
| LoRA training | FLUX.2 trainer $0.008/step (v2 $0.0255/step); Qwen trainer ≈$0.95 per character; Z-Image trainer | - | |

Endpoint ids for all of these are in `03-higgsfield-to-provider-mapping.md` §2 (fact-check) and in the catalog files.

### 3.6 When to use which

Use **fal** by default for everything: it is the only one of the two with a stable contract, official vendor relationships, always-on webhook signatures, per-endpoint schemas, a pricing API and breadth (training, 3D, matting, reframe, lipsync). Route to **Kie** for cost on the closed models where it is 1.5-4× cheaper (Veo 3.1 Fast/Lite, Seedance 2.x, Kling 3.0/O3, GPT Image 2, Nano Banana 2/Pro, Seedream 5, Grok video) and for models fal lacks (Suno, avatars, Runway Aleph), but only with a fal fallback, results copied at completion, idempotent webhooks, a token bucket under 20 creates per 10 s and a live 422-probe per binding before launch. Use **direct vendor APIs** only for ElevenLabs voice management and Gemini analysis. Never single-source production on Kie; never keep a provider URL as the only copy.

---

## 4. Capability coverage

`docs/CAPABILITY-MATRIX.md` is the authoritative per-id reference (fal endpoint, Kie id, other provider, fidelity, prices, catalog model). As of this commit it contains the provider strategy and the image sections (§3.1 generation, §3.2 editing/utilities); the video, audio, 3D and platform-tool sections it refers to (§3.3-3.6) still have to be appended from `03-higgsfield-to-provider-mapping.md` §1b-1e, which remains the source of truth for those classes until then.

**Fidelity summary across the 95 Higgsfield ids.**

- **Exact** (same upstream model, ~60 ids): all Google, OpenAI, ByteDance, BFL, Kling, xAI, Wan, MiniMax, Happy Horse, Z-Image, Topaz, Meshy, Tripo, Hunyuan3D, SAM 3, ElevenLabs/MiniMax/Qwen/Seed TTS, Sonilo/Mirelo/Inworld, Kling motion control (= Genjutsu motion), Seedance 2.5 video edit (= Ad Multiplier), sync-lipsync v3.
- **Substitute** (same class, different model, ~12 ids): background removal (BiRefNet/Bria, Higgsfield's upstream is unknown), ByteDance *image* upscale (confirmed absent on both providers; SeedVR2/Clarity/Topaz instead), generic outpaint/reframe (FLUX.2 outpaint, Bria expand, Luma reframe), Recraft (fal only), CosyVoice (Chatterbox), video deflicker (ffmpeg), object replace (Wan 2.2 Animate replace / Runway Aleph / Gemini Omni edit), voice library (ElevenLabs official).
- **Approximation** (product feature rebuilt as prompt system or pipeline, ~20 ids): Soul 2/Cinema/Cast/Location, Cinema Studio 2.5/3.0/video, Marketing Studio image/video, `ms_image`, `image_auto`, AutoSprite, `higgsfield_preset` (62 presets), Clipify, virality predictor, `text2speech_v2` (an engine selector), workflows.
- **Dropped or deferred:** apps marketplace, 3D scene builder, website builder, TikTok publishing (unaudited apps are private-only, ≤5 users/24 h), contests, unlimited/trial mechanics, legacy models (Kling 2.6, Seedance 1.5, Veo 3 non-3.1, Hailuo 2.3, FLUX Kontext), the 678-clip animation library.

**What the implemented catalog covers (38 models, 69 bindings).** Image: `nano_banana_pro`, `nano_banana_2`, `flux_2_pro`, `flux_2_flex`, `flux_2_max`, `flux_kontext_pro`, `gpt_image_2`, `seedream_v5_pro`, `seedream_v5_lite`, `seedream_v4_5`, `kling_image_o1`, `z_image_turbo`, `grok_image_2`, `qwen_image`. Video: `kling_3_0`, `kling_3_0_turbo`, `kling_motion_control`, `seedance_2_0`, `seedance_2_0_mini`, `seedance_2_5`, `veo_3_1`, `veo_3_1_fast`, `veo_3_1_lite`, `wan_3_0`, `wan_2_7`, `minimax_h3`, `hailuo_2_3`, `grok_video`, `gemini_omni_flash_1_1`, `ltx_2`. Utilities: `upscale_image_topaz`, `upscale_image_clarity`, `remove_background`, `outpaint`, `upscale_video_topaz`, `upscale_video_bytedance`, `reframe_video`, `video_background_removal`. Through `higgsfield_ids` these cover 43 Higgsfield ids (every Google, OpenAI, ByteDance, BFL, Kling, xAI, Wan and MiniMax image/video entry a marketer uses day to day, Ad Multiplier, Genjutsu motion, and the upscale/background/outpaint utilities); it is the MVP scope (image + video) by design.

**Deferred from the catalog:** audio (TTS, voice clone, music, SFX, dubbing, lipsync, all mapped, none bound yet), 3D (Meshy/Tripo/Hunyuan/SAM 3D), FLUX 3 video, Happy Horse, Wan 2.6, Kling O3 reference-to-video, Seedance 2.5 `video_extension` semantics, LoRA trainers, SAM 3 video segmentation, Luma reframe (bound as `reframe_video` but price unverified), Recraft, Ideogram, Imagen 4, and all Kie-only models (Suno, avatars, Runway Aleph).

---

## 5. Non-replicable and product-level features: approximation strategies

- **Soul / Soul ID.** No fal or Kie endpoint (the fal registry of 2026-09-02 has zero `higgsfield` entries). Three tiers: (1) reference-image identity with 3-6 curated refs stored as an element and injected into `fal-ai/kling-image/o1` ($0.028, `@Image1…@Image10` maps almost 1:1 onto `<<<uuid>>>`), `fal-ai/nano-banana-pro/edit` or `bytedance/seedream/v5/pro/edit`, good for ~70-80% of shots; (2) LoRA training on `fal-ai/flux-2-trainer` ($0.008/step, ≈$8 per 1,000-step character; `-v2` at $0.0255/step), `fal-ai/qwen-image-2512-trainer-v2` (≈$0.95 per character) or `fal-ai/z-image-trainer`, inference on `fal-ai/flux-2/lora` ($0.021/MP); (3) exact Soul via WaveSpeedAI `higgsfield/soul` ($0.09/run, no Soul-ID) or Higgsfield's platform API (`POST /v1/text2image/soul`, `custom_reference_id`) behind a feature flag. Ship (1) first, (2) as an opt-in "train character" job, (3) only on demand. Likeness consent for real people must be a policy before (2) ships.
- **Soul Cast / Location.** Same element store; for video pass the refs into Kling 3.0 `elements[]` (fal: `{frontal_image_url, reference_image_urls[]}`, `@Element1…`) or Seedance 2.x `reference_image_urls` so image and video share one identity source.
- **Cinema Studio.** A prompt-compiler: shot type, lens/focal length, camera move, lighting, film stock, aspect, negatives → an LLM rewrites into model-specific prompts over Seedream 5 Pro / FLUX.2 Pro (stills) and Kling 3.0 pro multi-shot or Seedance 2.5 (video). No model to buy; a taxonomy and templates to write.
- **Presets / DoP.** Encode each of the 62 presets as a prompt template plus optional first/last-frame trick over `fal-ai/kling-video/v3/pro/image-to-video`, `bytedance/seedance-2.0/image-to-video` or `wan/v2.6/image-to-video`, with a preview clip rendered once. Exact DoP motion only via Higgsfield/WaveSpeed (`higgsfield/dop`, $0.125 per 5 s).
- **Marketing Studio / DTC ads.** A chain: product cutout (`birefnet/v2`) → hero shots (`nano-banana-pro/edit`, `gpt-image-2/edit` for packshot text, Seedream 5 Pro edit) → hook script (LLM) → avatar clip (Kie `omnihuman-1-5`, `kling/ai-avatar-pro`, `infinitalk/from-audio`; or HeyGen/Hedra) → TTS → lipsync (`sync-lipsync/v3`) → assembly (ffmpeg in a sandbox) → subtitles. Brand kit = stored JSON (palette, fonts, logo asset ids, tone). A common pattern is a storyboard sheet generated as one wide image and then animated into a single clip.
- **Ad Multiplier.** Exact: `bytedance/seedance-2.5/reference-to-video` with the source clip as a video reference and a change list, fanned out N times; Kie `bytedance/seedance-2-5` at roughly half the price; cheaper substitutes `wan/2-7-videoedit`, `alibaba/happy-horse/video-edit`.
- **Genjutsu.** Motion transfer = Kling 3.0 motion control (exact, bound as `kling_motion_control`); object swap = `fal-ai/wan/v2.2-14b/animate/replace` ($0.04-0.08/s), Runway Aleph (Kie `/api/v1/aleph`, official $0.28/s) or Gemini Omni Flash 1.1 edit.
- **Clipify / Shorts Studio.** Ingest (user upload or Supadata/Apify transcripts at ≈$0.025 per request; `yt-dlp` is a YouTube ToS risk) → STT (`fal-ai/whisper` or ElevenLabs Scribe) → LLM highlight scoring → ffmpeg 9:16 crop with `fal-ai/sam-3/video` or MediaPipe face tracking → burned ASS subtitles → optional upscale, all in an E2B/Modal/Vercel sandbox. Shorts restyling = Gemini Omni Flash 1.1 / Seedance 2.5 video-to-video with a style preset.
- **Virality predictor / video analysis.** Gemini 3.1 Pro or Flash with the video as input and a rubric (hook < 3 s, pattern interrupts, caption density, loudness); ≈18k tokens for a 60-second clip. Unvalidated as a predictor, sell it as analysis, not prediction.
- **Sandbox.** E2B ($0.0504/vCPU-h), Modal, or Vercel Sandbox ($0.128/vCPU-h, 5 CPU-hours free on Hobby) with a custom image; the same "one phase = one self-contained call, upload to a pre-reserved media slot" contract Higgsfield uses.
- **Website builder, marketplace apps, 3D scene builder, TikTok.** Drop or defer (Cloudflare Workers for Platforms, headless Blender, TikTok Content Posting API audit). None of it is core to an agency's media pipeline.

---

## 6. Architecture as built

`docs/ARCHITECTURE.md` and `docs/DECISIONS.md` (ADR-001 … ADR-008) are the reference; this section explains the choices and what they cost.

**Data-driven catalog with declarative bindings (ADR-003).** `ModelDefinition` mirrors Higgsfield's `models_explore` shape so UI, REST and MCP are self-describing from one object; each `ProviderBinding` carries an `InputMappingSpec` (prompt, aspect-ratio field or size map, duration format, count, role → provider field, parameter renames and value maps, constants) and an `OutputMappingSpec` (paths such as `images[].url`, `video.url`, `resultUrls[]`), plus `endpointByMode` for fal's per-mode endpoint families and Kie's `*-text-to-image` / `*-image-to-image` slugs, `pricing` with parameter-conditioned modifiers, `priority`, `verified`, `notes`. Benefit: adding a model is a data change, the catalog is auditable against provider OpenAPI without running code, prices can be synced. Trade-off: exotic models (Kling `elements[]` objects, Seedance multi-reference arrays with count limits, Wan 3.0 document/link references) need new mapping-spec features when they arrive; the spec grows as needed rather than sprouting per-model code.

**Normalisation with adjustments.** `normalizeRequest` validates a Higgsfield-style request and reports non-fatal fixes (nearest aspect ratio, clamped duration, defaulted params, role coercion) as `adjustments`, exactly as Higgsfield's MCP does. This is what makes LLM callers robust.

**Router (ADR-002).** `ProviderRouter` keeps only configured providers and orders bindings by `preferred` (env `PROVIDER_PREFERENCE=fal,kie`), `cheapest` (static unit price) or `quality` (binding priority); `StudioService` falls back on infrastructure errors only, never on input errors (a 422 on Kie is a mapping bug, not a reason to double-spend on fal).

**Webhook-first, poll-on-read, Postgres as the state machine (ADR-004).** `generations` holds the state (`pending → queued → running → succeeded | failed | cancelled`); providers call `/api/webhooks/{provider}?g=<id>&t=<hmac>`; the route responds 200 immediately and processes in `after()`; every read of a non-terminal generation (UI, API, MCP `jobs_wait`) refreshes it from the provider, rate-limited to once per 3 s; `POST /api/internal/reconcile` polls everything overdue and times jobs out after 45 minutes, scheduled by `pg_cron` + `pg_net` every minute (`0002_reconcile_cron.sql`) because Vercel Hobby crons are daily. Two independent completion paths, no orchestrator dependency. Trade-off: multi-step pipelines have no durable executor yet; Vercel Workflow or Inngest is reserved for phase 2.

**Copy every output into our storage (ADR-005).** fal keeps outputs ≥7 days on public URLs, Kie 14 days with 20-minute signed links and 3-day uploads. `storeOutputs` → `copyToStorage` streams each output into the private `media` bucket (`media_assets` + `generation_outputs`) before `finalize`; the provider URL is kept only as a fallback if the copy fails. Served through signed URLs. Trade-off: storage and egress are ours to pay (§9) and a 200 MB video copy has to finish inside the function's `maxDuration` (300 s on webhooks).

**Ledger in USD, reservation → settlement/release (ADR-007).** Append-only `ledger_entries` (`reservation`, `settlement`, `release`, `adjustment`, `topup`) with a `ledger_balances` view; a reservation equal to the estimate is placed before submission and settled (actual cost, Kie `creditsConsumed × $0.005`) or released on completion. `MONTHLY_BUDGET_USD` is enforced in `StudioService.assertBudget` before submission (the roadmap checkbox lags the code). Trade-off: Kie has no preflight, so estimates for Kie come from the catalog and can be wrong by the month's price drift until reconciled.

**Idempotency and observability.** `(provider, provider_job_id)` and `(workspace, idempotency_key)` are unique; every submit/webhook/poll/cancel/upload is a `provider_events` row with `verified`, `http_status` and payload; realtime broadcasts on `workspace:<id>`.

**API-key MCP auth (ADR-006).** Hashed `rfl_` keys with scopes `generate`/`read`, revocation and last-used tracking authenticate both REST and MCP (`withMcpAuth`); `/.well-known/oauth-protected-resource` advertises issuers from `MCP_OAUTH_ISSUERS` for the OAuth phase.

**Security.** `server-only` modules, service-role client never in the browser, webhook signature *or* per-generation HMAC token, SSRF guard on URL imports (private ranges rejected), signed storage URLs, no secrets in the catalog.

### 6.1 What the sandbox could not verify, and how to verify it

Nothing in `packages/core/src/catalog/models/*.ts` has been exercised against a real provider: all 69 bindings are `verified: false`, and the request field names come from SDK sources, doc mirrors and snippets. Known soft spots: Seedream v5 endpoint ids (registry says `bytedance/seedream/v5/...` without `fal-ai/`); Kie `kling-3.0/video` requiring `multi_shots`; MiniMax H3 snake_case on the wire; Kie `resultJson` as a string; the Seedance 2.0 trailing-space key; Wan 3.0 and H3 billing units on fal; GPT Image 2 defaulting to `high`; the fal `elements[]` shape; Kie's Kling naming fork. Verification plan, in order:

1. Deploy to Vercel (Pro) with real `FAL_KEY` / `KIE_API_KEY`, `APP_BASE_URL` set so webhooks resolve, `ENABLE_MOCK_PROVIDER=false`.
2. `FAL_KEY=… pnpm --filter @reflow/core catalog:verify`, for every fal binding it builds a sample body through `buildProviderInput` and diffs it against the endpoint's `/v1/models?expand=openapi-3.0` input schema (unknown fields, missing required fields, endpoint 404s); then `catalog:prices` diffs `pricing.usd` against `/v1/models/pricing`. Fix, flip `verified`, set `verified_at`.
3. Kie has no schema API: run one cheapest-configuration live call per Kie binding (a 422-probe) and record the outcome in `notes`.
4. First cheap runs, one per model, cheapest parameters: `z_image_turbo` ($0.005), `nano_banana_2` on Kie ($0.04), `seedream_v5_lite`, `flux_2_pro`, then video at minimum duration/resolution (Kling 3.0 std 3 s, Seedance 2.0 Mini 480p, Veo 3.1 Lite). Exercising all 38 models once costs roughly $5-10.
5. Read `provider_events` (kind, `verified`, `http_status`, payload) and `generations.provider_input` / `provider_ref` to confirm bodies, webhook delivery and signature verification; if fal webhooks arrive unverified, check JWKS reachability from Vercel and both hosts; for Kie, enable `webhookHmacKey` in Kie settings and set `KIE_WEBHOOK_SECRET`, otherwise only the `t` token protects the route.
6. Kill the webhook path once (wrong `APP_BASE_URL`) and confirm the reconciler and poll-on-read close the jobs; confirm the 45-minute timeout releases reservations.
7. Reconcile the ledger against `GET /v1/models/usage` (fal) and `creditsConsumed` / balance deltas (Kie) for the first week and adjust `pricing` modifiers.

---

## 7. MCP design

**Spec status.** MCP 2026-07-28 is GA: protocol sessions and `Mcp-Session-Id` are gone, there is no `initialize` handshake (every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` and client capabilities), servers must implement `server/discover`, `tools/list` and friends must carry `ttlMs` + `cacheScope`, server-initiated requests were replaced by multi-round-trip `input_required` results, SSE resumability was removed, `Mcp-Method`/`Mcp-Name` headers are required on every POST, and tasks moved to the `io.modelcontextprotocol/tasks` extension. No host in the official client matrix supports the tasks extension yet and the TypeScript SDK v2 answers inbound `tasks/*` with `-32601`, so video jobs stay application-level handles (`generate_* → id → jobs_wait`) shaped like a task for a later `tasks/*` façade. `mcp-handler` 2.1.1 + `@modelcontextprotocol/server` 2.0.0 serve the new spec and fall back to 2025-era stateless Streamable HTTP for today's hosts; on that fallback there is no return path for elicitation, so cost confirmation must stay an explicit argument (`get_cost: true`), never an elicitation. (https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx, https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)

**Auth options per client.** Claude Code: `claude mcp add --transport http reflow-studio <url> --header "Authorization: Bearer rfl_…"`, works today. Cursor: `mcp.json` `headers`, works, with one known bug: when a server publishes RFC 9728 protected-resource metadata Cursor ignores the headers and forces OAuth (forum thread 156054), so the PRM endpoint should answer 404 while `MCP_OAUTH_ISSUERS` is empty, verify this behaviour before handing keys to Cursor users. Claude.ai custom connectors: paid plans only; static headers exist in beta but only for **org admins on Team/Enterprise**; individual Pro/Max users get OAuth (DCR, CIMD, or pre-registered client credentials in the connector's advanced settings); redirect `https://claude.ai/api/mcp/auth_callback`, PKCE S256, 401 + `WWW-Authenticate: Bearer resource_metadata=…`. ChatGPT: OAuth or no auth only.

**Why API keys first, OAuth via Supabase later (ADR-006).** Keys cover every client the team uses today (Claude Code, Cursor, n8n, scripts) with the least code and mirror Higgsfield's own key-based connectors. OAuth is needed for individual Claude.ai users and ChatGPT. Supabase's OAuth 2.1 server (public beta, free during beta) is the planned authorization server: issuer `https://<ref>.supabase.co/auth/v1`, authorization-code + PKCE, a consent page we build (`getAuthorizationDetails` / `approveAuthorization`), tokens that are ordinary Supabase JWTs with a `client_id` claim so RLS applies. Its gaps decide the sequencing: **no CIMD support** (discussion #41695 unanswered), redirect URIs are exact-match including port (breaks loopback clients with random ports), custom scopes unsupported (derive `mcp_scopes` from our tables in a Custom Access Token Hook), and no RFC 8707 `resource` binding (substitute: `client_id` allow-list plus a hook that rewrites `aud` to the MCP URL). Concrete steps are in `07-mcp-architecture.md` §2.4; `verifyToken` accepts both an `rfl_` key and a Supabase JWT.

**MCP Apps verdict.** The `io.modelcontextprotocol/ui` extension (spec 2026-01-26, stable) is supported by Claude web/Desktop, ChatGPT, Cursor, VS Code Copilot and others, but not by Claude Code. Two things only a widget solves for media: file intake from the user's machine (Higgsfield's `media_upload_widget` exists because remote tools cannot read chat attachments) and progressive display of a two-minute video job. Everything else works as text plus signed URLs, and that fallback is mandatory anyway. Decision: phase-2 progressive enhancement (a `show_jobs` gallery resource at `ui://reflow/gallery.html` with declared `connectDomains`/`resourceDomains`), never the primary result channel.

**Tool-design rules adopted.** ≤15 model-visible tools, typed verbs plus a `model` parameter plus `models_explore` (the MCP roadmap of 2026-08-22 warns against hundred-tool servers); flat schemas, `params` as an open object; submit → handle → bounded wait (`generate_*` returns within seconds, `jobs_wait` ≤20 s with `all_terminal` and `poll_after_seconds`, never per-job polling); `get_cost` preflight without elicitation; `adjustments` and typed errors (`isError: true`, `error.code`, recovery hints) instead of protocol errors; structured output plus the same JSON as text; URLs and `resource_link`s first, base64 `image` blocks only for small previews (Claude Code warns at 10k tokens); routing rules in `server/discover.instructions`; annotations on every tool (`readOnlyHint` on reads, `destructiveHint` only on cancel); deterministic `tools/list` order with `ttlMs ≥ 300000`; rate limits and spend caps per key returned as tool errors with `retry_after_s`; media values are asset ids or generation ids, never raw URLs; provider text never echoed verbatim. Still to add: an `idempotency_key` argument on `generate_*` (the database already has the unique index) and `outputSchema` declarations.

The 12 tools as built: `models_explore`, `generate_image`, `generate_video`, `jobs_wait`, `get_generation`, `show_generations`, `cancel_generation`, `media_import_url`, `media_upload`, `media_confirm`, `show_medias`, `balance` (`docs/MCP.md`). Batch tools were dropped on purpose: several `generate_*` calls plus one `jobs_wait` do the same job with fewer schemas in context.

---

## 8. Roadmap

Consistent with `docs/ROADMAP.md`; dependency order matters more than dates.

- **Phase 0: research (done).** Review of the public MCP tool vocabulary, provider deep-dives with fact-checks, mapping, stack evaluation, this dossier.
- **Phase 1, MVP (this repository; remaining items).** Done: core catalog and bindings, adapters with signed webhooks, normalisation, cost estimation, router, mock provider, unit tests; Supabase schema; REST API; MCP server; studio UI; budget guard in code. Remaining, in order: (1) Vercel Pro + Supabase Pro + `pg_cron` deployment; (2) live verification per §6.1 and flipping `verified`; (3) price sync; (4) a nightly live smoke against the cheapest model per provider with a $0.05 budget guard. Exit criterion: one week of real usage with every generation reconciled in the ledger.
- **Phase 2, parity.** Depends on phase 1. Elements (`<<<uuid>>>` placeholders → injected references, element library UI) → characters (LoRA training bindings + reference fallback) → presets (62 templates with previews) → one-click utilities on any result → batch fan-out and pipelines on Vercel Workflow or Inngest → audio bindings (ElevenLabs/MiniMax/Seed TTS, voice clone, sync-lipsync v3, music/SFX) → realtime UI via Supabase broadcast → OAuth 2.1 on Supabase → optional MCP Apps gallery widget.
- **Phase 3, product layers.** Depends on phase 2's elements, audio and pipelines. Workflow library (original prompt programs written for this project, served as MCP prompts/resources) → marketing chains with sandbox assembly (ffmpeg) → video analysis and clip pipeline (Gemini + Whisper + SAM 3) → 3D via fal → multi-tenant workspaces and Stripe if the studio is sold to clients.

---

## 9. Cost model

**Per-generation examples (list, USD).** Using §3.5 and Higgsfield at $0.033-0.05 per credit:

| Job | Own studio via fal | Own studio via Kie | Higgsfield |
|---|---|---|---|
| 4 Nano Banana 2 variants, 1K | $0.32 | $0.16 | 6 cr → $0.20-0.30 |
| 1 Nano Banana Pro, 4K | $0.30 | $0.12 | 2 cr → $0.07-0.10 |
| 1 GPT Image 2, 2K high | ≈$0.10-0.20 (token-billed) | $0.05 | 8.5 cr → $0.28-0.43 |
| 1 Seedream 5 Pro edit + 2 refs | $0.0765 | $0.0375 | not captured |
| Kling 3.0 pro, 10 s, audio | $1.68 | $1.35 | ≈35-40 cr → $1.16-2.00 |
| Seedance 2.5, 10 s, 720p, from a 10 s reference video | $4.73 | $1.90 | 75 cr observed → $2.48-3.75 |
| Veo 3.1 Fast, 8 s, audio | $1.20 | $0.30 | 40 cr → $1.32-2.00 |
| Veo 3.1 Lite, 8 s | $0.24-0.40 | $0.15 | 8 cr → $0.26-0.40 |
| Topaz video upscale, 10 s to 1080p | $0.20 | $0.40 | ≈3 cr → $0.10-0.15 |
| One LoRA character (1,000 steps FLUX.2) | $8 (+$0.021/MP inference) | - | Soul ID 25 cr → $0.83-1.25 |

**Monthly infrastructure (before generation spend).** Vercel Pro $20 per seat plus Fluid compute usage (one deployer seat is enough); Supabase Pro $25 (includes 100 GB storage, 250 GB cached + 250 GB uncached egress, 500 GB uploads, image transformations, 500 Realtime connections); storage beyond that ≈$0.021/GB-month and cached egress $0.03/GB, at 200 GB of media and 300 GB egress roughly $3.50; Sentry Developer and Axiom Personal free; Vercel Workflow or Inngest free tiers for phase 2; total **≈$45-75 per month**. Cloudflare R2 ($0.015/GB-month, zero egress) is the escape hatch if video egress passes ~250 GB. (Sources: supabase.com pricing and egress docs mirrored in supabase/supabase `apps/docs`; vercel.com/docs/plans/hobby snippet.)

**Break-even for a small agency (three people, social ads).** Monthly mix: 800 Nano Banana 2, 400 Nano Banana Pro 2K, 300 Seedream 5 Pro, 100 Kling 3.0 std 5 s, 50 Seedance 2.0 720p 5 s, 40 Veo 3.1 Fast 8 s.

- fal only: $64 + $90 + $20 + $42 + $76 + $48 ≈ **$340**; plus infra ≈ $400.
- `cheapest` routing (Kie where available): $32 + $36 + $10.50 + $35 + $51 + $12 ≈ **$177**; plus infra ≈ **$240**; with a realistic 20-30% fal fallback share ≈ $260-280.
- Higgsfield: ≈5,700 credits (1,200 + 800 + 450 + 550 + 1,100 + 1,600). One Ultra annual seat ($99, 3,000 credits) plus ≈2,700 top-up credits (≈$142 at $0.0526) ≈ **$240**: but a single user who times image work inside the unlimited windows (Nano Banana Pro 7-day, FLUX.2 Pro and Seedream 4.5 365-day) can push the image credits toward zero and land near **$100-130**. Three seats on a Team plan ($79 per seat) start at ≈$237 before top-ups.

Reading: at this volume the own studio with cheapest routing is at parity with one aggressively optimised Higgsfield seat and clearly cheaper than a three-seat team; every extra seat, video or API/MCP call at cost widens the gap, which narrows to zero for an image-only single user. Break-even is therefore roughly **two seats or ≈4,000-5,000 credits per month of video-heavy usage**, before valuing ownership, retention (no 90-day expiry) and the absence of vendor churn. Enforce the `MONTHLY_BUDGET_USD` cap from day one and review `ledger_entries` weekly for the first quarter; Kie's price drift and fal's compute-second models are the two ways this model goes wrong.

---

## 10. Risks and legal

| Risk | Mitigation |
|---|---|
| **Trademark.** "Higgsfield", "Soul", "Genjutsu", "Popcorn", "DoP", "Cinema Studio" are Higgsfield's names. | The product is Reflow Studio; Higgsfield appears only in interoperability notes and `higgsfield_ids`. Generic tool names (`generate_image`, `jobs_wait`) are plain English identifiers, not marks. Never market as "Higgsfield alternative" using their marks in product UI. |
| **Provider ToS.** Kie is an unofficial reseller (Veo via Google's consumer "Flow" routing, Suno without a public API, Midjourney gray, Sora gone 2026-09-24, a co-operator under litigation). Client deliverables produced on Kie carry that exposure. | fal-first routing; Kie only behind the router with fal fallback; no Suno/Midjourney/Sora bindings; per-client opt-out of Kie; keep `provider` on every generation so provenance is auditable. |
| **Output licensing.** Commercial rights depend on the upstream model licence (fal `metadata.license_type`; Higgsfield Free tier grants none). | Bind only commercial-licence models; record licence per model in the catalog `notes`. |
| **Content moderation.** fal runs safety checkers by default; Kie's `nsfw_checker` defaults to false on several models and Grok has a `spicy` mode; upstream moderation still rejects. | Do not disable checkers by default; keep prompts out of shared logs; log rejection category only; a written acceptable-use policy for the workspace; likeness consent for character training. |
| **Expiring URLs.** fal ≥7 days, Kie 14 days / 20-minute links / 3-day uploads; fal purged legacy CDN paths in June 2026. | Copy-to-storage at completion (built); provider URL only as fallback; alert on copy failures. |
| **Model churn and schema drift.** Sora removal, Luma removed from Kie, Gemini Omni preview deprecating 2026-09-30, Kling naming fork, Kie key typos, monthly price changes. | Data-driven bindings, `catalog:verify`/`catalog:prices` in CI weekly, nightly live smoke, `verified_at` dates, `status: deprecated` on models. |
| **Vendor lock-in.** fal endpoint ids and the queue contract are fal-specific. | Provider-agnostic core, dual bindings on most models, `ProviderAdapter` is five methods; a third adapter (Replicate, WaveSpeed, vendor direct) is a data-plus-adapter change. |
| **Vercel Hobby is non-commercial** (fair-use guidelines; accounts get paused) and limits crons to daily and functions to 300 s. | Vercel Pro before launch (ADR-001); reconciler scheduled in Postgres regardless. |
| **Supabase free tier** caps uploads at 50 MB and lacks image transforms. | Supabase Pro. |
| **Data protection (EU agency).** Prompts, uploads and outputs are processed by US providers and their upstreams (some China-based). DPAs and sub-processor lists were not verified (unverified). | Data-minimise (`X-Fal-Store-IO: 0` where payload storage is not needed), retention policy on `media_assets`, document sub-processors, no client PII in prompts. |
| **Budget runaway** (loops, batch fan-out, compute-second billing). | `MONTHLY_BUDGET_USD`, reservations before submission, per-key scopes, rate limits per tool class, `get_cost` preflight in MCP instructions. |
| **Security.** Webhook spoofing, SSRF via imports, key leakage, prompt injection through provider strings. | Signature or HMAC token on every webhook (built), private-range guard (built), hashed keys with revocation (built), never echo provider text verbatim (to enforce in the MCP layer). |
| **Kie rate limit** (20 creates / 10 s, 429 not queued). | Token bucket in the Kie adapter before batch fan-out ships. |

---

## 11. Open design questions (as of 2026-09-05)

1. Move to **Vercel Pro and Supabase Pro now** (commercial-use clause, 500 GB uploads, per-minute crons), or host the Next.js app elsewhere and keep Vercel for previews?
2. Default routing: **`preferred` (fal-first, reliability)** or **`cheapest` (Kie-first, 30-75% lower)**: and is Kie acceptable at all for client-facing deliverables given its reseller posture?
3. Will you enable Kie's `webhookHmacKey` and provide `KIE_WEBHOOK_SECRET`, or is the per-generation token sufficient for the MVP?
4. Ledger presentation: keep **USD at provider cost** (as built) or add a EUR display and a margin for re-billing clients?
5. Which MCP clients must work first? API keys already cover Claude Code, Cursor and n8n; **individual Claude.ai connectors need the OAuth phase**: should it move ahead of presets/audio?
6. Character strategy: reference-only elements, **LoRA training (≈$1-8 per character)**, or a WaveSpeed/Higgsfield adapter for the exact Soul look, and what likeness-consent policy applies to training on real people?
7. Storage and retention: Supabase-only, or R2 for video from the start; how long are outputs and uploads kept?
8. Is **multi-tenant with Stripe** in scope for 2026? It changes RLS, workspaces and the ledger design now rather than later.

---

## 12. Sources

Deduplicated; all accessed 2026-09-05. Hosts marked † were reachable only as search-engine snippets or via GitHub mirrors from the research sandbox.

**fal.ai †**: https://docs.fal.ai/reference/platform-apis/authentication · https://docs.fal.ai/model-apis/model-endpoints/queue · https://docs.fal.ai/model-apis/model-endpoints/webhooks · https://docs.fal.ai/model-apis/model-endpoints/workflows · https://docs.fal.ai/model-apis/payloads · https://docs.fal.ai/reference/platform-apis/openapi-schema · https://fal.ai/docs/documentation/model-apis/concurrency-limits · https://fal.ai/docs/platform-apis/v1/models/usage · https://fal.ai/docs/documentation/setting-up/mcp · https://fal.ai/legal/terms-of-service · https://fal.ai/legal/acceptable-use-policy · https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video · https://fal.ai/models/fal-ai/kling-image/o1 · https://fal.ai/models/bytedance/seedance-2.5/reference-to-video · https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image · https://fal.ai/models/fal-ai/veo3.1 · https://fal.ai/models/fal-ai/nano-banana-pro · https://fal.ai/models/openai/gpt-image-2 · https://fal.ai/models/fal-ai/flux-2-pro · https://fal.ai/models/fal-ai/flux-2-trainer/api · https://fal.ai/models/fal-ai/topaz/upscale/video/api · https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video · https://fal.ai/models/fal-ai/sam-3/video · https://fal.ai/models/fal-ai/birefnet/v2/api · https://fal.ai/models/luma/agent/ray/v3.2/reframe · https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace/api · https://fal.ai/wan-3 · https://fal.ai/models/google/gemini-omni-flash/v1.1/edit · https://github.com/fal-ai/fal-js · https://github.com/fal-ai/fal · https://github.com/fal-ai-community/n8n-nodes-fal · https://github.com/gokayfem/ComfyUI-fal-API (registry export, 2026-09-02) · https://github.com/fal-ai-community/video-starter-kit · https://github.com/thorwhalen/falaw

**Kie.ai †**: https://docs.kie.ai/llms.txt · https://docs.kie.ai/market/kling/kling-3-0 · https://docs.kie.ai/market/bytedance/seedance-2 · https://docs.kie.ai/veo3-api/generate-veo-3-video · https://docs.kie.ai/common-api/webhook-verification · https://docs.kie.ai/file-upload-api/quickstart · https://kie.ai/pricing · https://kie.ai/api-key · https://github.com/hassanvfx/kie-api-python (verbatim docs mirror) · https://github.com/felores/kie-ai-mcp-server · https://github.com/felores/kie-cli-mcp · https://github.com/elibarnett/kie-mcp (pricing drift-watch) · https://github.com/justintanner/apicity · https://github.com/nodaroai/app.nodaro.ai · https://github.com/aqm857886159/Nomi (doc-vs-live audit 2026-09-02) · https://github.com/Thepizzapie/BuildersGate · https://github.com/mvanhorn/printing-press-library

**Higgsfield †**: https://higgsfield.ai/ · https://mcp.higgsfield.ai/mcp (live connector, read-only tools) · https://higgsfield.ai/camera-controls · https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-create-and-use-a-soul-id-character · https://github.com/higgsfield-ai/higgsfield-js · https://github.com/higgsfield-ai/skills · https://github.com/higgsfield-ai/cursor-plugin · https://www.npmjs.com/package/@higgsfield/cli · https://wavespeed.ai/models/higgsfield/soul/image-to-image

**MCP**: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx · https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx · https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx · https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/client-matrix.mdx · https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/blog/content/posts/2026-08-22-mcp-roadmap.md · https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx · https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md · https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md · https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx · https://github.com/vercel/mcp-handler · https://github.com/anthropics/claude-ai-mcp/issues/112 · https://code.claude.com/docs/en/mcp · https://cursor.com/docs/mcp † · https://forum.cursor.com/t/mcp-headers-config-ignored-when-server-has-oauth-discovery/156054 · https://github.com/runwayml/runway-api-mcp-server · https://github.com/elevenlabs/elevenlabs-mcp

**Supabase / Vercel / stack**: https://github.com/supabase/supabase/tree/master/apps/docs/content/guides/auth/oauth-server · https://github.com/supabase/supabase/tree/master/apps/docs/content/guides (realtime limits, storage file limits, egress, cron, queues) · https://github.com/orgs/supabase/discussions/41695 (CIMD) · https://vercel.com/docs/plans/hobby † · https://vercel.com/docs/functions/configuring-functions/duration † · https://vercel.com/docs/cron-jobs/usage-and-pricing † · https://vercel.com/docs/workflows/pricing † · https://vercel.com/docs/sandbox/pricing † · https://github.com/vercel/workflow · https://github.com/vercel/ai · https://github.com/pgr0ss/pgledger · https://inngest.com/pricing † · https://trigger.dev/pricing †

**Other vendors †**: https://elevenlabs.io/pricing/api · https://sync.so/docs/product/billing · https://developer.topazlabs.com/getting-started/model-pricing · https://ai.google.dev/gemini-api/docs/video-understanding · https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post · https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing · https://x.ai/api · https://bfl.ai/pricing · https://platform.minimax.io/docs/guides/pricing

**Repository**: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/SETUP.md`, `docs/MCP.md`, `docs/CAPABILITY-MATRIX.md`, `packages/core/src/catalog/types.ts`, `packages/core/src/catalog/models/*.ts`, `packages/core/scripts/verify-catalog.ts`, `apps/web/src/lib/studio/service.ts`, `apps/web/src/lib/mcp/server.ts`, `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_reconcile_cron.sql`; research reports `01` to `07` in this directory.
