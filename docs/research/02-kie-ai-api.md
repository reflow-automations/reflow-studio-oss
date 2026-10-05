<!-- Research report generated 2026-09-05 by autonomous research agents; sources are cited inline. Facts marked (unverified)/[M]/[U] were not confirmed against primary sources. -->

# Kie.ai API Deep-Dive (state as of 5 September 2026)

## 0. Method and source caveats

- `kie.ai`, `docs.kie.ai`, `old-docs.kie.ai`, `kieai.mintlify.app`, `fal.ai`, Trustpilot and most review blogs were **blocked by the sandbox egress proxy**. I therefore used: (a) search-engine snippets of docs.kie.ai pages, (b) **verbatim mirrors of the official docs** committed to GitHub (`hassanvfx/kie-api-python/docs/kie-ai/raw/**`, a scrape of `https://docs.kie.ai/llms.txt` and every page as `.md`/OpenAPI-style markdown; `hirakawat-hmp/claude-plugin-kie/docs/**`; `felores/kie-cli-mcp/docs/kie/*.md`; `ndjordjevic/agentic-ai-wiki/raw/web/kie.ai.md`, fetched 2026-07-02), (c) community client source code that embeds Kie's live pricing/catalog (`elibarnett/kie-mcp/data/{pricing,registry-*}.mjs`, with dated "drift-watch" notes through 2026-08-26), (d) a third-party **doc-vs-live audit dated 2026-09-02** (`aqm857886159/Nomi/docs/research/2026-09-02-docaudit-kie.md`), (e) review articles (bitdoze 2026-07-17 via its GitHub source; aisofting/aiinsightsnews via snippets).
- Anything not backed by one of those is marked **[unverified]**. Prices are in Kie credits; **1 credit = US$0.005** everywhere below.

---

## 1. Authentication, base URLs, pricing model, limits, balance

| Item | Value | Source |
|---|---|---|
| API base URL | `https://api.kie.ai` | Getting Started mirror (`docs.kie.ai/1973359m0`), all model pages |
| Auth header | `Authorization: Bearer <API_KEY>` (+ `Content-Type: application/json`) | same |
| Key management | `https://kie.ai/api-key` (reset from dashboard if leaked) | same |
| File-upload base URL | `https://kieai.redpandaai.co` (separate host, same Bearer key) | `docs.kie.ai/file-upload-api/quickstart` mirror |
| Anthropic-compatible proxy | `ANTHROPIC_BASE_URL=https://api.kie.ai/claude` (Claude Code guide, `docs.kie.ai/2152008m0`); keys look like `sk-kie-…` | search snippet of official page |
| OpenAI-compatible chat | Gemini/GPT/Claude "(openai)" pages under `/market/chat`, `/market/gemini`, `/market/claude`, `/market/codex` | llms.txt |
| Credit unit | **1 credit = $0.005** | kie.ai/pricing snippets, bitdoze 2026-07-17, newtosh skill |
| Packs | $5 = 1,000 cr; $20 = 4,000 cr; $50 = 10,000 cr ("5% discount" marketing); $200 pack; **$1,250+ top-ups get +10% bonus credits** | kie.ai/pricing snippets, Getting Started mirror |
| Free tier | 80 free credits on signup, no time-limited trial | search snippets (aisofting) |
| Expiry | "KIE credits do not expire" | Getting Started mirror |
| Failed tasks | "Failed tasks are not charged" (official). Community adapter notes `501` can still bill after job creation and `500` is "unknown", treat as **disputed** | Getting Started mirror vs `Thepizzapie/BuildersGate/src/bgate_adapters/kie.py` |
| Actual cost | Returned only after completion as `creditsConsumed` (Veo family), there is **no pre-flight cost endpoint** (unlike Higgsfield `get_cost:true`) | Veo callback docs; BuildersGate |
| Rate limit | **20 new task creations / 10 s per account (~120/min)**; excess → HTTP/body `429`, request is **not queued** | Getting Started mirror; confirmed by Kie support 2026-08-15 (BuildersGate comment) |
| Concurrency | "No strict concurrency limit"; "100+ concurrent running tasks" typical; higher rate on request via support | same |
| Balance endpoint | `GET https://api.kie.ai/api/v1/chat/credit` → `{"code":200,"msg":"success","data":100}` (`data` = integer credits) | `common-api/get-account-credits` mirror |
| Logs | `https://kie.ai/logs`; log records retained 2 months | Getting Started mirror |
| Support | Discord/Telegram 1:1 via `kie.ai/vip-support`; email `support@kie.ai`; hours **UTC 21:00 → 17:00 next day**, 365 d | Getting Started mirror |
| Self-declared stability | "Our overall stability may be slightly lower than official providers. This is a conscious trade-off." | Getting Started mirror |

Important response convention: **the JSON body `code` is the real status; HTTP 200 with `code != 200` is an application error** (felores ENDPOINTS.md; BuildersGate).

---

## 2. Job lifecycle

### 2.1 Endpoint families (table)

| Family | Create | Poll | Extras | Result shape |
|---|---|---|---|---|
| **Unified "Market"/jobs** (all `market/*` models: Kling, Seedance, Sora 2, Wan, Hailuo, MiniMax H3, Nano Banana, GPT Image 1.5/2, Flux‑2, Seedream, Ideogram, Qwen, Grok Imagine, Topaz, Recraft, ElevenLabs, Infinitalk, OmniHuman, HappyHorse, PixVerse, Z‑Image, Imagen 4, gemini-omni-video…) | `POST /api/v1/jobs/createTask` body `{ "model": "<slug>", "input": {...}, "callBackUrl": "https://..." }` → `{code,msg,data:{taskId}}` | `GET /api/v1/jobs/recordInfo?taskId=` | - | `data.state ∈ {waiting, queuing, generating, success, fail}`; `data.resultJson` is a **JSON string** → parse → `{ "resultUrls": [ ... ] }`; also `param` (JSON string of request), `failCode`, `failMsg`, `costTime` (ms), `completeTime`, `createTime`, `updateTime` (epoch ms), `progress` (0‑100, Sora 2 only), `model` |
| **Veo 3.1** | `POST /api/v1/veo/generate` | `GET /api/v1/veo/record-info?taskId=` | `GET /api/v1/veo/get-1080p-video?taskId=&index=`; 4K page `veo3-api/get-veo-3-4k-video` (+ its own callback page); extend page `veo3-api/extend-video` (exact paths for 4K/extend not seen verbatim → [unverified]) | `successFlag` 0 generating / 1 success / 2 failed / 3 created-but-generation-failed; `data.response.resultUrls` (real array), `originUrls`, `resolution`, `paramJson`, `fallbackFlag`, `creditsConsumed` |
| **GPT‑4o Image** | `POST /api/v1/gpt4o-image/generate` | `GET /api/v1/gpt4o-image/record-info?taskId=` | `POST /api/v1/gpt4o-image/download-url` `{taskId,url}` → signed URL valid 20 min | `successFlag` 0/1/2, `status: "SUCCESS"`, `response.resultUrls`, `progress: "1.00"` |
| **Flux Kontext** | `POST /api/v1/flux/kontext/generate` | page `flux-kontext-api/get-image-details` (path likely `/api/v1/flux/kontext/record-info` [unverified]) | callback page | `successFlag`-style; original image URL valid 10 min |
| **Runway Gen‑4 Turbo** | `POST /api/v1/runway/generate` | `GET /api/v1/runway/record-detail?taskId=` | extend page `runway-api/extend-ai-video` | `successFlag`, `response.{taskId, resultVideoUrl, resultImageUrl}` |
| **Runway Aleph** | `POST /api/v1/aleph/generate` | `GET /api/v1/aleph/record-info?taskId=` | - | as above |
| **Midjourney** (availability contested, see §6) | `POST /api/v1/mj/generate` | `GET /api/v1/mj/record-info?taskId=` | - | `successFlag` 0/1/2/3, `resultInfoJson.resultUrls[{resultUrl}]`, `paramJson`, `errorCode`, `errorMessage` |
| **Suno** | `POST /api/v1/generate` (**`callBackUrl` is required**) | `GET /api/v1/generate/record-info?taskId=` | ~20 sibling endpoints (extend, upload‑and‑extend, upload‑and‑cover, add‑instrumental, add‑vocals, cover, replace‑section, persona, mashup, lyrics, wav, separate‑vocals, midi, music‑video, boost‑style, timestamped‑lyrics, sounds, voice‑validate/generate), each with its own `*-details` GET and callback page | **uppercase** statuses `PENDING, TEXT_SUCCESS, FIRST_SUCCESS, SUCCESS, CREATE_TASK_FAILED, GENERATE_AUDIO_FAILED, CALLBACK_EXCEPTION, SENSITIVE_WORD_ERROR`; result is a real nested object `data.response.sunoData[]` (2 tracks per call) |
| **Gemini Omni** | `POST /api/v1/jobs/createTask` model `gemini-omni-video` | jobs | `POST /api/v1/omni/character/create`, `POST /api/v1/omni/audio/create` | jobs shape |
| **Common** | `POST /api/v1/common/download-url` `{url}` → fresh signed URL (20 min; only Kie-hosted URLs, else 422) | `GET /api/v1/chat/credit` | webhook verification page | - |

Sources: llms.txt mirror; `market/common/get-task-detail`, `veo3-api/*`, `4o-image-api/*`, `runway-api/*`, `mj-api/*` (felores mirror), `suno-api/generate-music`, `common-api/download-url` mirrors; neokahu `src/api.ts`.

### 2.2 Callback (webhook) contract

- Mechanism: pass `callBackUrl` (top-level for jobs/Veo/4o/Flux/Runway/MJ/Suno; some n8n templates put it inside `input`, both appear to be accepted [unverified]). Kie `POST`s JSON, `Content-Type: application/json`.
- **Timeout 15 s; after 3 consecutive delivery failures Kie stops**; "the same taskId may receive multiple callbacks, ensure processing is idempotent"; "return 200 as soon as possible, process asynchronously" (Veo, MJ, 4o callback pages).
- **Signature (official, `common-api/webhook-verification`)**: headers `X-Webhook-Timestamp` (unix seconds) and `X-Webhook-Signature` = `base64(HMAC-SHA256(taskId + "." + timestamp, webhookHmacKey))`; the HMAC key is created on the Kie Settings page; compare constant-time. No documented tolerance window, enforce your own (e.g. ±5 min).
- Payload shapes **differ per family** (a normalizer is mandatory):
  - Jobs/market: identical to `recordInfo.data` (`taskId, model, state, param, resultJson(string), failCode, failMsg, costTime, completeTime, createTime`).
  - Veo: `{code, msg, data:{taskId, promptJson, info:{resultUrls[], originUrls[], resolution}, fallbackFlag, creditsConsumed}}`; failure codes 400 (policy / non-English / image access / unsafe image), 422 (fallback failed), 500, 501.
  - 4o Image: `data.info.result_urls[]`; failure `code` 400/451/500.
  - Runway Gen‑4: `data.{task_id, video_id, video_url, image_url}`; Aleph: `{code,msg,data:{result_video_url,result_image_url},taskId}`; MJ: `data.{taskId, promptJson, resultUrls[]}`.
  - Suno: three callbacks per task, `callbackType ∈ {text, first, complete}`, tracks under `data.data[]`.
- Live vs doc discrepancies (audit 2026‑09‑02): `resultJson` is always a string on the wire although some examples show an object; callbacks originate from Kie's temp-file domains, not the example hostnames; observed URL lifetimes differ from documented ones → **download assets immediately**.

### 2.3 Polling guidance, states, latency

- Official: poll every 2-3 s with exponential backoff, stop after 10-15 min; task creation `200` only means "accepted".
- Observed latencies (community, 2026): Nano Banana 2 Lite ~4 s; Flux Kontext Pro 8-10 s; GPT Image 2 i2i 15-30 s; GPT‑4o image 20-120 s; ElevenLabs TTS seconds; Suno ~60 s; Veo 3.1 T2V ~61 s, reference/first‑last modes 2-5 min; Seedance 2.x 3-4 min (208 s `costTime` observed); Sora 2 2-5 min; Veo 1080p upscale 1-3 min, 4K 5-10 min; Veo `408` if upstream returns nothing after 10+ min.

### 2.4 Error codes (body `code`)

| Code | Meaning (official wording where available) | Billed? |
|---|---|---|
| 200 | success / task accepted | - |
| 400 | bad request; on Veo also "1080P still processing, retry in 1-2 min", content flagged, image fetch failed | no |
| 401 | missing/invalid key | no |
| 402 | insufficient credits | no |
| 404 | task/endpoint not found (also returned for an **invalid model slug**) | no |
| 408 | Veo: upstream produced no result after 10+ min | ? |
| 409 | Suno: conflict | no |
| 422 | validation error; Veo: "rejected by Flow"; download-url: external URL | no |
| 429 | rate limited (not queued) | no |
| 451 | image/asset could not be fetched from your URL | no |
| 455 | system maintenance | no |
| 500 | server error / timeout | unknown |
| 501 | generation failed after creation | official: not charged; community: sometimes charged |
| 505 | feature disabled | no |
| 550 | listed on 4o generate page, undocumented meaning | - |
| Cloudflare 1010 | browser-integrity block on the upload host when User‑Agent missing/odd | - |

### 2.5 Result URL / retention

- Generated media: **14 days** then deleted (Getting Started, Suno, Runway, 4o, Flux Kontext pages); MJ page says 15 days; the unified `get-task-detail` page says "URLs typically expire after 24 hours"; download-url signed links **20 min**; Flux Kontext `originImageUrl` 10 min. Result hosts observed: `tempfile.aiquickdraw.com`, `file.aiquickdraw.com`. **Architecture rule: copy every result to your own bucket (R2/S3) inside the callback.**

---

## 3. File handling

| Method | Endpoint (base `https://kieai.redpandaai.co`) | Body | Limits |
|---|---|---|---|
| Base64 | `POST /api/file-base64-upload` (JSON) | `base64Data` (raw or data‑URL), `uploadPath` (required, e.g. `images/user-uploads`), `fileName?` | recommended ≤10 MB |
| Public URL | `POST /api/file-url-upload` (JSON) | `fileUrl`, `uploadPath`, `fileName?` | recommended ≤100 MB, 30 s download timeout |
| Stream | `POST /api/file-stream-upload` (multipart/form-data) | `file`, `uploadPath`, `fileName?` | for >10 MB; no stated max |

Response: `{success, code, msg, data:{fileId, fileName, fileSize, mimeType, fileUrl, downloadUrl, expiresAt}}`; **uploaded files auto-delete after 3 days** (one page says 24 h → treat as 24 h to be safe). Byte-signature type validation; send a normal `User-Agent` to avoid Cloudflare 1010. Uploads are free (0 credits).

All model inputs are **public HTTPS URLs** (`image_urls`, `image_input`, `input_urls`, `first_frame_url`, `reference_*_urls`, `video_url(s)`, `audio_url`, `fileUrls`…). There is no presigned-PUT flow and no media-id concept (contrast Higgsfield `media_upload`/`media_id`). Some families accept `uploadCn: true` (store result on Alibaba OSS instead of R2) and Sora accepts `upload_method: s3|oss`. Per-model input limits (official pages): Nano Banana 2 up to 14 images ≤30 MB each (JPEG/PNG/WebP); Nano Banana Pro up to 8; GPT Image 2 i2i up to 16; Seedance 2.0: 9 images, 3 videos (MP4/MOV, 480-720p, 2-15 s, <50 MB, 24-60 fps), 3 audios (WAV/MP3, 2-15 s, <15 MB), frame images 300-6000 px, aspect 0.4-2.5, <30 MB; Seedance 2.5: up to 30 images / 10 videos / 10 audios, 4-30 s output [community]; Kling 3.0 motion‑control: 1 image ≤10 MB >340 px, 1 video ≤100 MB 3-30 s; Wan 3.0: 10 images, 5 videos, 5 audios (≤15 s combined), a 100 MB/50‑page document, or one web link; Topaz video ≤50 MB MP4/MOV/MKV; Infinitalk image ≤10 MB, audio ≤10 MB (mp3/wav/aac/mp4/ogg); OmniHuman audio <60 s; Sora storyboard images ≤10 MB jpeg/png/webp.

---

## 4. Model catalog (identifiers, schemas, prices)

Conventions: `$` = credits × 0.005. "cr/s" = credits per output second. Prices marked **(pub)** come from Kie's published pricing as recorded by `elibarnett/kie-mcp` drift-watch (dates given); **(emp)** = empirically measured `creditsConsumed`; **(mkt)** = Kie marketing pages/press; **(rev)** = bitdoze 2026‑07‑17. Where sources conflict I list both.

### 4.1 Video

| Model (Kie identifier) | Class | Key params | Price | Notes |
|---|---|---|---|---|
| `veo3` (Veo 3.1 Quality) via `/api/v1/veo/generate` | t2v, i2v (1 img), first+last (2 imgs) | `prompt`, `imageUrls[1-2]`, `model`, `generationType ∈ TEXT_2_VIDEO / FIRST_AND_LAST_FRAMES_2_VIDEO / REFERENCE_2_VIDEO`, `aspect_ratio ∈ 16:9/9:16/Auto`, `resolution ∈ 720p/1080p/4k` (default 720p), `enableTranslation` (default true), `watermark`, `enableFallback` (deprecated), `callBackUrl`; 8 s fixed | (mkt) $2.00/8 s = 400 cr; (emp 2026) 250 cr/8 s = $1.25; (rev) ~$1.28 at 1080p | Docs say "25% of official Google pricing"; 4K ≈2× Fast cost; 1080p upscale 5 cr flat, 4K 120 cr flat (emp 2026‑06‑01); no 1080p upgrade for fallback videos |
| `veo3_fast` (Veo 3.1 Fast, default) | t2v, i2v, ref2v (`REFERENCE_2_VIDEO` requires veo3_fast) | same | (mkt) $0.40/8 s = 80 cr; (emp) 168 cr/8 s = $0.84 | |
| `veo3_lite` (Veo 3.1 Lite) | t2v, i2v | same | (emp) 30 cr/8 s = $0.15 | |
| Veo extend (`veo3-api/extend-video`) | video‑extension | original taskId + prompt | ~31 cr/s assumed | [unverified path] |
| `sora-2-text-to-video`, `sora-2-image-to-video` | t2v, i2v (+audio) | `prompt ≤10k`, `aspect_ratio ∈ landscape/portrait`, `n_frames ∈ '10','15'`, `remove_watermark`, `character_id_list[≤5]`, `upload_method ∈ s3/oss` | (mkt) $0.15/10 s = 30 cr | **OpenAI sunsets the Sora API on 2026‑09‑24** → expect removal |
| `sora-2-pro-text-to-video`, `sora-2-pro-image-to-video` | t2v/i2v pro | + `size ∈ standard/high` (default high) | (mkt) $0.45/10 s standard = 90 cr; $1.00/10 s HD = 200 cr | same sunset |
| `sora-2-pro-storyboard` | multi-shot storyboard | `n_frames ∈ '10','15','25'`, `image_urls`, `aspect_ratio` | - | plus `sora-2-characters`, `sora-2-characters-pro`, `sora-watermark-remover` |
| `kling-3.0/video` | t2v, i2v (first/last), multi-shot, elements | `prompt`, `image_urls[1-2]`, `duration '3'-'15'` (default '5'), `aspect_ratio ∈ 16:9/9:16/1:1`, `mode ∈ std(720p)/pro(1080p)/4K`, `sound`, `multi_shots`, `multi_prompt[≤5]{prompt≤500, duration 1-12}`, `kling_elements[≤3]{name, description, element_input_urls[2-4], element_input_video_urls}`; live also accepts `customize_multi_shots`, `prefer_multi_shots`; i2v forces `aspect_ratio=auto` (audit) | 12 cr/s std (pub); pro higher | ~$0.06/s std |
| `kling-3.0/motion-control` | motion transfer | `input_urls[1]`, `video_urls[1]`, `prompt ≤2500`, `mode std/pro`, `character_orientation ∈ video/image`, `background_source ∈ input_video/input_image` | 12 cr/s | |
| `kling-3.0-omni/text-to-video`, `/image-to-video`, `/reference-to-video`, `/transformation` | t2v, i2v, ref2v, v2v | `duration 3-15`, `resolution 720p/1080p/4K`, `audio`, `customize_multi_shots`, `multi_prompt[]`, `video_urls` (transformation) | (pub 2026‑08‑26) 720p 14 cr/s no‑audio, 18 with audio; 1080p 18/23; 4K 67; transformation 20/27/67 | Kling "O3" |
| `kling/v3-turbo-text-to-video`, `kling/v3-turbo-image-to-video` | t2v/i2v fast | `duration 3-15`, `resolution 720p/1080p` | (pub) 18 cr/s 720p, 22.5 cr/s 1080p | |
| `kling-2.6/text-to-video`, `kling-2.6/image-to-video`, `kling-2.6/motion-control` | t2v/i2v (+native audio), motion | `duration 5/10`, `aspect_ratio`, `sound`; motion: `input_urls`, `video_urls`, `mode 720p` | 10 cr/s | |
| `kling/v2-5-turbo-text-to-video`, `kling/v2-5-turbo-image-to-video` (docs: "…-pro") | t2v/i2v | tail image optional | 8 cr/s | |
| `kling/v2-1-standard`, `kling/v2-1-pro`, `kling/v2-1-master-text-to-video`, `kling/v2-1-master-image-to-video` | i2v/t2v | `image_url`, `duration 5/10`, `negative_prompt`, `cfg_scale 0-1` | 5 / 10 / 32 cr/s | |
| `kling/ai-avatar-standard`, `kling/ai-avatar-pro` | talking avatar (lipsync) | `image_url`, audio, `prompt` | 5 / 10 cr/s | |
| `bytedance/seedance-2` | t2v, i2v, ref2v (multimodal), audio | `prompt 3-20k`, `first_frame_url`, `last_frame_url`, `reference_image_urls[≤9]`, `reference_video_urls[≤3]`, `reference_audio_urls[≤3]`, `generate_audio` (default true), `resolution 480p/720p/1080p` (default 720p), `aspect_ratio ∈ 1:1,4:3,3:4,16:9,9:16,21:9,adaptive`, `duration 4-15` (default 5), `web_search`, `nsfw_checker` (default false) | 25 cr/s @720p with video input (pub) | frames and reference_* are mutually exclusive |
| `bytedance/seedance-2-fast` | t2v/i2v (images only) | as above, 480p/720p | 20 cr/s | |
| `bytedance/seedance-2-mini` | budget multimodal | 480p/720p | (pub 2026‑08‑26) 480p 2.4 (w/ video) / 3.8; 720p 5 / 8.2 cr/s | |
| `bytedance/seedance-2-5` | long-form multimodal (4-30 s) | + `extension_task_id`, `return_last_frame`; 30 img / 10 vid / 10 audio refs [community] | (pub 2026‑08) 480p 28 cr/s (17 w/ video input); 720p 63 (38); emp: 4 s 480p = 112 cr | most expensive per second on Kie |
| `bytedance/seedance-1.5-pro` | t2v/i2v (+audio, dialogue) | `duration 8/10`, `resolution 480p/720p/1080p`, `input_urls` | 8 cr/s | |
| `bytedance/v1-pro-text-to-video`, `v1-pro-image-to-video`, `v1-pro-fast-image-to-video`, `v1-lite-text-to-video`, `v1-lite-image-to-video` | Seedance 1.0 | `duration 2-12`, `resolution`, `aspect_ratio` (7), `end_image_url`, `camera_fixed`, `seed` | pro 6, pro‑fast 4, lite 2/4.5/10 cr/s (480/720/1080p) | |
| `wan/3-0-video`, `wan/3-0-video-prime` | t2v/i2v/ref2v/doc2v (+audio) | `prompt ≤20k`, `first/last_frame_url`, `reference_image_urls[≤10]`, `reference_video_urls[≤5]`, `reference_audio_urls[≤5]`, `reference_file_urls`, `reference_link_urls`, `resolution 480P/720P/1080P` (default 1080P), `aspect_ratio adaptive/16:9/4:3/1:1/3:4/9:16`, `duration 2-30 or -1`, `audio` (default true), `seed`, `nsfw_checker` | 3.0: 8/16/32 cr/s; Prime: 12.2/25.2/50.4; billed on input+output duration (pub 2026‑08‑26) | |
| `wan/2-7-text-to-video`, `2-7-image-to-video`, `2-7-videoedit`, `2-7-r2v` | t2v/i2v/edit/ref2v | `duration 5/10`, `resolution 720p/1080p`, `negative_prompt`, `seed`, `reference_image_urls` | 5 cr/s | |
| `wan/2-6-text-to-video`, `2-6-image-to-video`, `2-6-video-to-video`, `2-6-flash-image-to-video`, `2-6-flash-video-to-video` | t2v/i2v/v2v | `duration 5/10/15`, `resolution 720p/1080p`, `audio` | 4 cr/s; flash 6 (emp 2026‑08‑05) | |
| `wan/2-5-text-to-video`, `2-5-image-to-video` | t2v/i2v | 720p/1080p | 12 / 20 cr/s (pub) | |
| `wan/2-2-a14b-text-to-video-turbo`, `…-image-to-video-turbo`, `…-speech-to-video-turbo`, `wan/2-2-animate-move`, `wan/2-2-animate-replace` | ultra-budget, speech2video, motion animate | `resolution 480p/580p/720p`, `enable_prompt_expansion`, `seed`, `video_url`+`image_url` | 2-3 cr/s | Higgsfield's `wan2_6/2_7/3_0` map here |
| `minimax-h3/text-to-video`, `/image-to-video`, `/reference-to-video` | t2v/i2v/ref2v (+audio) | `duration 4-15` (docs) / 3-10 (community), `aspectRatio ∈ 21:9,16:9,4:3,1:1,3:4,9:16(,adaptive)`, `first_frame_url`, `last_frame_url`, `referenceImageUrls[1-9]`, `referenceVideoUrls[1-3]`, `referenceAudioUrls[1-3]`, `resolution 768P/2K` | 16 cr/s 768P, 26 cr/s 2K, +8 cr per extra input image (pub) | note camelCase here |
| `hailuo/02-text-to-video-pro/standard`, `hailuo/02-image-to-video-pro/standard`, `hailuo/2-3-image-to-video-pro/standard` | t2v/i2v | `duration 6/10`, `resolution 768P`, `prompt_optimizer`, `end_image_url` | std 4 cr/s, pro 8 cr/s | |
| `grok-imagine/text-to-video`, `grok-imagine/image-to-video`, `grok-imagine/upscale`, `grok-imagine/extend`, `grok-imagine-video-1-5-preview` | t2v/i2v/upscale/extend | `mode ∈ fun/normal/spicy`, `duration 6-30`, `resolution 480p/720p`, `aspect_ratio`, `nsfw_checker` | 2.4/4.5/8 cr/s (480/720/1080p, pub 2026‑08‑10); upscale 10 cr flat; extend 3; v1.5 preview 3 cr/s @720p (emp) | |
| `happyhorse/text-to-video`, `/image-to-video`, `/reference-to-video`, `/video-edit`; `happyhorse-1-1/*` | t2v/i2v/ref2v/edit | 720p/1080p | 28/48 cr/s; 1.1: 22.5/29 cr/s (pub) | |
| `pixverse-v6/text-to-video`, `/image-to-video`, `/transition`, `/extend`, `/reference-to-video` | t2v/i2v/transition/extend/ref2v | 360p-1080p, audio | 4.0-18.4 cr/s (pub) | |
| Runway Gen‑4 Turbo (`/api/v1/runway/generate`) | t2v/i2v | `prompt ≤1800`, `imageUrl`, `duration 5/10`, `quality 720p/1080p` (no 1080p@10 s), `aspectRatio 16:9/4:3/1:1/3:4/9:16`, `waterMark`, `callBackUrl` required | (mkt) $0.05/s; (pub) 12 cr/5 s | extend endpoint 6 cr/s |
| Runway Aleph (`/api/v1/aleph/generate`) | v2v edit | `prompt`, `videoUrl`, `aspectRatio` (6), `seed`, `referenceImage`, `waterMark`, `uploadCn` | 6 cr/s | |
| `topaz/video-upscale` | upscale | `video_url ≤50 MB`, `upscale_factor '1'/'2'/'4'` | 8 cr flat (pub) [suspiciously low; verify] | |
| `infinitalk/from-audio` | lipsync (image+audio→talking video) | `image_url`, `audio_url`, `prompt ≤5000`, `resolution 480p/720p`, `seed 10000-1000000`; max 15 s | 4 cr/s (~$0.015/s 480p, $0.06/s 720p per neokahu) | |
| `omnihuman-1-5` (+ free `omnihuman-1-5/subject-detection`) | lipsync/avatar | `image_url`, `audio_url` (<60 s), `mask_url[≤5]`, `prompt`, `output_resolution 720/1080`, `pe_fast_mode`, `seed` | 27 cr/s of audio (pub) | |
| `volcengine/video-to-video-lip-sync` | video lipsync | video + audio | 8 cr/s (pub) | |
| `gemini-omni-video` (+ `/api/v1/omni/character/create`, `/api/v1/omni/audio/create`) | multimodal video (Google) | images, 1 video, audio IDs, character IDs, duration, ratio, resolution, seed; quota ≤7 units | ~30 cr/s (estimate) | maps to Higgsfield `gemini_omni` |
| Luma | - | **Not present in the current docs index**; only the Go SDK (`izetmolla/kieai`, older) has `GenerateLumaVideo` | - | treat as removed |

### 4.2 Image

| Model | Class | Key params | Price |
|---|---|---|---|
| `nano-banana-pro` | t2i, i2i (≤8 refs) | `prompt ≤10k`, `image_input[≤8]`, `aspect_ratio ∈ 1:1,2:3,3:2,3:4,4:3,4:5,5:4,9:16,16:9,21:9,auto`, `resolution 1K/2K/4K`, `output_format png/jpg` | 18 cr 1K/2K, 24 cr 4K (felores doc, early 2026) → $0.09-0.12; elibarnett 24 flat |
| `nano-banana-2` | t2i, i2i (≤14 refs, 30 MB) | `prompt ≤20k`, `image_input`, `aspect_ratio` (15 incl. 1:4, 4:1, 1:8, 8:1, auto), `resolution 1K/2K/4K`, `output_format jpg/png`; `google_search` [community] | (rev 2026‑07) $0.04/0.06/0.09 = 8/12/18 cr; elibarnett 4 cr @1K |
| `nano-banana-2-lite` | t2i (1K only, ~4 s) | `image_urls[≤10]`, 15 ratios | 4 cr (emp 2026‑07‑02) |
| `google/nano-banana`, `google/nano-banana-edit` | t2i / i2i (Gemini 2.5 Flash Image) | `image_size` (11 ratios+auto), `image_urls[1-10]`, `output_format` | 4 cr |
| `gpt-image-2-text-to-image` (docs) / `gpt-image/2-text-to-image` (community), `gpt-image-2-image-to-image` (≤16 refs) | t2i / i2i | `prompt ≤20k`, `aspect_ratio ∈ auto,1:1,9:16,16:9,4:3,3:4` (community: 11), `resolution 1K/2K/4K` (1:1 ≠ 4K; auto → 1K), `nsfw_checker` | 8 cr (pub); (rev) ~$0.03 |
| `gpt-image/1.5-text-to-image`, `gpt-image/1.5-image-to-image` | t2i/i2i | `aspect_ratio 1:1/2:3/3:2`, `quality medium/high` | 6 cr |
| GPT‑4o Image (`/api/v1/gpt4o-image/generate`) | t2i/i2i/mask edit | `prompt`, `filesUrl[≤5]`, `size 1:1/3:2/2:3`, `nVariants 1/2/4`, `maskUrl ≤25 MB`, `isEnhance`, `enableFallback`, `fallbackModel GPT_IMAGE_1/FLUX_MAX` | 6 cr |
| `seedream/5-pro-text-to-image`, `5-pro-image-to-image`, `5-pro-layer-decomposition` | t2i/i2i/layers | `aspect_ratio` (7), `quality`, `size`, `output_format`, `image_urls` | 7 cr 1K/1.5K, 14 cr 2K (+0.5 cr/input image, first free); layers billed per output layer (pub 2026‑08‑26) |
| `seedream/5-lite-text-to-image`, `5-lite-image-to-image` | t2i/i2i | `quality basic/high` | 5 cr |
| `seedream/4.5-text-to-image`, `seedream/4.5-edit` | t2i/i2i | 8 ratios, `quality basic(2K)/high(4K)` | 5 cr (neokahu: 4) |
| `bytedance/seedream-v4-text-to-image`, `-v4-edit`, `bytedance/seedream` (3.0) | t2i/i2i | `image_size` (9 presets), `image_resolution 1K/2K/4K`, `max_images 1-6`, `guidance_scale`, `seed` | 3.5 cr |
| `flux-2/pro-text-to-image`, `pro-image-to-image`, `flex-text-to-image`, `flex-image-to-image` | t2i/i2i (≤8 refs) | `aspect_ratio` (7-8), `resolution 1K/2K`, `input_urls[1-8]` | pro 5, flex 4 cr |
| `flux-kontext-pro`, `flux-kontext-max` (`/api/v1/flux/kontext/generate`) | t2i/i2i | `aspectRatio 21:9/16:9/4:3/1:1/3:4/9:16`, `inputImage`, `outputFormat jpeg/png`, `promptUpsampling`, `safetyTolerance 0-6 (edit 0-2)`, `enableTranslation`, `uploadCn`, `watermark` | 50 / 100 cr per registry [looks inflated vs. $0.04 official, verify] |
| `google/imagen4`, `imagen4-fast`, `imagen4-ultra` | t2i | `aspect_ratio` (5), `negative_prompt`, `seed`, `num_images 1-4` (fast) | 5 / 3 / 10 cr |
| `ideogram/v3-text-to-image`, `v3-edit` (mask), `v3-remix`, `v3-reframe` (outpaint), `ideogram/character`, `character-edit`, `character-remix` | t2i/inpaint/style/outpaint/character | `image_size` (6), `rendering_speed TURBO/BALANCED/QUALITY`, `style` (4), `expand_prompt`, `negative_prompt`, `strength`, `num_images 1-4`, `mask_url`, `reference_image_urls` | 5 cr (neokahu: 3.5/7/10 by speed) |
| `qwen3/text-to-image`, `qwen3/image-to-image`, `qwen3/pro-*` (Qwen Image 3.0) | t2i/i2i | `image_size` (5), `resolution 1K/2K`, `prompt_extend`, `negative_prompt`, `seed`, `nsfw_checker` | 4.8 cr (pro 6.4 @1K, 12 @2K; +0.5/input) (pub 2026‑08‑26) |
| `qwen/text-to-image`, `qwen/image-to-image`, `qwen/image-edit`, `qwen2/text-to-image`, `qwen2/image-edit` | t2i/i2i | `num_inference_steps`, `guidance_scale`, `acceleration`, `strength` | 4 / 3 cr |
| `grok-imagine/text-to-image`, `image-to-image`; `grok-imagine-image-2-0/text-to-image`, `/segment-map` (free), `/image-edit` (region) | t2i/i2i/segment/edit | `aspect_ratio` (5), `mask_indexs` | 4 cr; segment‑map 0 |
| `wan/2-7-image`, `wan/2-7-image-pro` | t2i/i2i (≤9 refs, sequential 1-12) | `aspect_ratio` (8), `resolution 1K/2K/4K`, `n`, `enable_sequential`, `thinking_mode`, `color_palette`, `bbox_list`, `watermark`, `seed` | 4.8 / 12 cr (pub 2026‑07‑27) |
| `z-image` | t2i budget | `aspect_ratio` (5) | 3 cr |
| `topaz/image-upscale` | upscale 1-8× | `image_url`, `upscale_factor 1/2/4/8` | 4 cr (elibarnett) / 10-40 cr by output size (neokahu) |
| `recraft/remove-background`, `recraft/crisp-upscale` | bg removal / upscale | `image` | 2 cr |
| Midjourney (`/api/v1/mj/generate`) | t2i/i2i/style-ref/omni-ref/video | `taskType ∈ mj_txt2img, mj_img2img, mj_style_reference, mj_omni_reference, mj_video, mj_video_hd`, `speed relaxed/fast/turbo`, `version 7/6.1/6/5.2/5.1/niji6`, `aspectRatio` (11), `stylization 0-1000`, `weirdness 0-3000`, `variety 0-100`, `fileUrl(s)`, `ow 1-1000`, `videoBatchSize 1/2/4`, `motion high/low`, `waterMark`, `enableTranslation` | not published | availability contested (§6) |

### 4.3 Audio / music / speech

| Model | Class | Key params | Price |
|---|---|---|---|
| Suno `POST /api/v1/generate` | music (2 tracks/call) | `model ∈ V4, V4_5, V4_5PLUS, V4_5ALL, V5, V5_5`, `customMode` (bool, req), `instrumental` (req), `prompt` (≤500 simple; ≤3000 V4 / ≤5000 V4.5+ custom), `style` (≤200 V4 / ≤1000), `title ≤80`, `negativeTags`, `vocalGender m/f`, `styleWeight`, `weirdnessConstraint`, `audioWeight` (0-1), `personaId`, `callBackUrl` (required) | 10 cr/call (elibarnett) / 11 cr (other resellers); Kie does not publish |
| Suno siblings | extend, upload‑extend, upload‑cover, cover, add‑instrumental, add‑vocals, replace‑section, mashup, persona, lyrics, boost‑style, timestamped‑lyrics, wav, separate‑vocals, midi, music‑video, sounds (SFX with bpm/key), cover‑art, voice‑validate (free) / voice‑generate / voice‑regenerate (custom voice cloning) | - | 2-10 cr each (community) |
| `elevenlabs/text-to-speech-multilingual-v2` | TTS | `text ≤5000`, `voice` (80+ names or voice_id), `stability`, `similarity_boost`, `style`, `speed 0.7-1.2`, `timestamps`, `previous_text`, `next_text`, `language_code` | 12 cr / 1000 chars (ceil) (emp 2026‑06‑11) = $0.06 |
| `elevenlabs/text-to-speech-turbo-2-5` | TTS fast | same | 6 cr / 1000 chars (emp) = $0.03 |
| `elevenlabs/text-to-dialogue-v3` | multi-speaker TTS | `dialogue[{text, voice}]` | 14 cr / 1000 chars linear (emp) |
| `elevenlabs/sound-effect-v2` | SFX | `text`, `loop`, `prompt_influence`, `output_format`, duration 1-30 | - |
| `elevenlabs/audio-isolation`, `elevenlabs/speech-to-text` | isolation / STT (diarization) | `audioUrl` | 3 cr flat each |
| `google/gemini-3-1-flash-tts`, `google/gemini-2-5-pro-tts` | TTS (30 voices, 2‑speaker) | text, voice, style tags | ~4.2 cr/min (token-priced) |
| Lipsync | see video table: `infinitalk/from-audio`, `omnihuman-1-5`, `volcengine/video-to-video-lip-sync`, `kling/ai-avatar-*`, `wan/2-2-a14b-speech-to-video-turbo` | | |

Not on Kie (vs Higgsfield/fal): Luma (removed), Meshy/Tripo/Hunyuan 3D (none), Sync.so lipsync, Recraft v4 t2i (only utilities), Topaz generative image, video background removal, SAM‑3, MiniMax/Seed TTS cloning (only Suno voice clone), Sonilo/Mirelo/Inworld audio, Higgsfield Soul/Cinematic proprietary models.

---

## 5. SDKs, samples, specs, MCP

- **Official**: no SDK, no npm/PyPI package, no Postman collection. Docs are Mintlify-style; every page is retrievable as Markdown (`<page>.md`) and there is an **`https://docs.kie.ai/llms.txt` index** (mirrored above). Per-page OpenAPI fragments exist (the hassanvfx mirror shows OpenAPI-formatted request schemas), but no single downloadable OpenAPI file was found. Official code samples: cURL/Python/JS on quickstarts. Official MCP server: **none found** (searched `api.kie.ai/mcp`, docs index, announcements). Kie does publish an Anthropic-compatible proxy for Claude Code (`/claude`) and OpenAI-compatible chat endpoints.
- **Community (all unofficial)**:
  - `@felores/kie-ai-mcp-server` (npm; README refs v5.1.0, npm listing showed 3.6.0 on 2026‑07‑23), `@felores/kie-cli` (0.9), `@felores/kie-ai-openai-server` (0.7), stdio + streamable-HTTP, Docker/Coolify; SQLite task DB; `docs/kie/*.md` mirrors of ~47 model pages.
  - `elibarnett/kie-mcp` (`kie-mcp`, Node ≥18): 54+ image / 95+ video / 20+ audio tools; `data/pricing.mjs` + registries; weekly GitHub-Actions **drift-watch** against Kie's catalog/pricing, the best machine-readable catalog available.
  - `neokahu/kie-ai-mcp` (30 tools), `@andrewlwn77/kie-ai-mcp-server` (Veo + Nano Banana), `Pym/kie-mcp` (Rust), `mrdainami/kie-mcp`, `hirakawat-hmp/claude-plugin-kie` (Claude plugin + docs mirror), `newtosh/kie-ai-skill`, `krusemediallc/claude-code-ai-ad-builder-kie-ai` (skill reference), `hassanvfx/kie-api-python`, `gateway/kie-api` (Python, PolyForm‑Noncommercial licence), `gateway/ComfyUI-Kie-API` (ComfyUI nodes, changelog 2026‑01→03), `douhashi/kie-ruby`, `izetmolla/kieai` (Go, older endpoint set incl. Luma), `ArielleTolome/n8n-nodes-kie`, `weirdfingers/boards` (Suno V5_5 adapter), `justintanner/apicity` (`packages/provider/kie`), many n8n templates (`nusquama/n8nworkflows.xyz`).

---

## 6. Reliability and legal posture

- Operator: **NEXUSAI SERVICES LLC** jointly with **INNOLEAP AI LLC** (kie.ai/terms-of-use per snippet). ToS: purchased credits never expire; "refunds are supported if needed" (wording per snippet), but Trustpilot (~2.5/5, small sample) and reviews report unrefunded lost credits, tasks stuck 24 h, support only responsive in Asian hours (matches official UTC 21:00-17:00 window).
- Official vs unofficial: Kie states it is a reseller and that stability is "slightly lower than official providers". Signals of **non-partner/consumer-product routing**: Veo errors reference "rejected by **Flow**" (Google's consumer app) and 1080p/4K "upgrade tasks"; Suno has no public API at all, so any Suno API is unofficial; **Midjourney was pulled at Midjourney's request in 2025** per multiple reviews, yet `docs.kie.ai/mj-api/*`, `kie.ai/features/mj-api`, June 2026 Kie blog posts on MJ v8.2 and 2026 community MCP servers still expose `/api/v1/mj/generate`; the llms.txt mirror omits `mj-api` → status contested, treat as gray. ElevenLabs, Kling, ByteDance, MiniMax, Alibaba, Topaz, Ideogram, Recraft, BFL are plausibly resold through official APIs (all have public APIs) but no partnership announcement exists. **OpenAI deprecates the Sora/Videos API on 2026‑09‑24** (announced 2026‑03‑24; consumer app closed 2026‑04‑26), so Kie's 8 Sora 2 slugs are days from disappearing; Sora 2 was also the main source of outage complaints.
- Watermarking: Kie adds none by default; Veo/Flux/Runway/MJ/Wan accept an optional `watermark`/`waterMark` text; Sora offers `remove_watermark` and a `sora-watermark-remover` model (an explicit ToS-gray feature).
- Content policy: no published policy document; per-model `nsfw_checker` (default **false** on Seedance 2, Wan 3.0, Grok, GPT Image 2, Qwen3), Grok `mode: spicy`, Flux `safetyTolerance 0-6`; Suno `SENSITIVE_WORD_ERROR`; upstream moderation still applies (Veo 400 "content flagged", Aleph "caught by our AI moderator"). Reviews report inconsistent NSFW filter behaviour.
- Uptime: no public status page found; third-party monitors (toolify) only. Kie's own note plus reviews → **run a secondary provider (fal.ai) behind a router; never single-source production on Kie.**

---

## 7. Kie vs fal.ai (brief)

| Dimension | Kie.ai | fal.ai |
|---|---|---|
| Veo 3.1 | Fast $0.40-0.84/8 s; Quality $1.25-2.00/8 s; Lite $0.15/8 s | Fast $0.10/s ($0.80/8 s); Std $0.20/s no audio, $0.40/s with audio ($3.20/8 s); 4K $0.40-0.60/s |
| Kling 3.0 | std 12 cr/s = $0.06/s; Omni 720p $0.07-0.09/s; 4K $0.335/s | Kling 3 Pro $0.112-0.28/s |
| Nano Banana Pro | $0.09-0.12 | $0.15 |
| Sora 2 | $0.015/s std, $0.045/s Pro, $0.10/s Pro HD | Pro $0.30/s (720p) / $0.50/s (1080p) |
| ElevenLabs Turbo 2.5 | 6 cr = $0.03 / 1k chars | $0.05 / 1k chars |
| Seedance 1.5 Pro | 8 cr/s = $0.04/s | ~$0.26 per 5 s 720p+audio (≈$0.052/s) |
| Exclusive-ish on Kie | Suno (full suite), Midjourney (gray), GPT‑4o Image legacy, HappyHorse, Kling AI Avatar, Sora storyboard/characters, Gemini Omni | - |
| Missing on Kie | Luma, 3D (Meshy/Tripo/Hunyuan), Sync lipsync, video bg-removal, LoRA training, custom/open-source deployments | fal has most of these |
| Developer ergonomics | No official SDK; mixed naming (`callBackUrl`, `aspect_ratio` vs `aspectRatio`, `imageUrls` vs `image_urls` vs `image_input`); `resultJson` string; 3 different result envelopes; 14‑day/24‑h URL expiry, 3‑day upload expiry; polling recommended as fallback; HMAC webhook (good); no cost preflight; no status page; support hours | Official `@fal-ai/client` / `fal-client`, per-endpoint OpenAPI + typed schemas, queue API (`IN_QUEUE/IN_PROGRESS/COMPLETED`), signed webhooks, sync + streaming modes, `fal.storage.upload`, status page, official vendor partnerships |
| Verdict | 30-90% cheaper and broader closed-model catalog; use as primary for cost, with strict asset copying, idempotent webhooks and per-model schema adapters | Use as fallback/secondary and for anything Kie lacks; better contract for production SLAs |

---

## 8. Architecture implications for the Reflow studio

1. Build a **provider adapter layer** with three Kie envelope normalizers (jobs/market, Veo/4o/Flux/Runway/MJ "successFlag" style, Suno) and a per-model schema registry (import `elibarnett/kie-mcp/data/registry-*.mjs` as seed; run your own drift-watch weekly).
2. Ingest results only through your webhook: verify `X-Webhook-Signature`, dedupe by `taskId`, **immediately copy assets to R2/S3**, then mark done; keep a polling reconciler for tasks with no callback after N minutes.
3. Media input: upload user files to your own public bucket (or Kie's 3‑day upload host) and pass URLs; keep Higgsfield-style `media_id` abstraction on your side.
4. Cost model: maintain a local price table (credits × $0.005) and reconcile against `creditsConsumed`/balance deltas because Kie has no preflight cost API and prices drift monthly.
5. Rate limiting: token bucket ≤18 creates/10 s per key; consider multiple keys/accounts for burst; 429 is not queued.
6. Plan for churn: Sora 2 gone by 2026‑09‑24; Midjourney legally fragile; Luma already gone. Route those capabilities to fal/other providers.


---

## Fact-check (independent verifier, 2026-09-05)

19 confirmed · 2 refuted · 0 unverifiable out of 21 checked claims.

### Refuted / corrected claims
- **[c11]** Parameters confirmed (model enum veo3/veo3_fast/veo3_lite, default veo3_fast; generationType TEXT_2_VIDEO/FIRST_AND_LAST_FRAMES_2_VIDEO/REFERENCE_2_VIDEO with imageUrls 1-3; aspect_ratio 16:9/9:16/Auto default 16:9; resolution 720p/1080p/4k default 720p; quickstart FAQ: clips 'limited to 8 seconds'). Two errors: (1) the live docs (Sept-2026 search snippet) say REFERENCE_2_VIDEO is 'available for Fast/Lite models only' - the June mirror's 'only supports veo3_fast' is stale, so Lite also supports it now; (2) the marketing prices are stale: Kie's own pricing update (Skool 'KIE AI just updated their pricing') lists Veo 3 Fast 80 -> 60 credits ($0.30/8 s), Quality 400 -> 250 credits ($1.25), Fallback 300 -> 100 credits ($0.50). The 250-credit Quality probe agrees; elibarnett's 168-credit Fast probe conflicts with both the 60-credit list price and Kie's own doc statement that 4K costs '~2x the credits of a Fast video' (4K probe = 120 -> Fast ~60). 1080p 5 cr / 4K 120 cr remain single-source empirical (2026-06-01). Treat Fast as ~60 credits/8 s until re-measured. (https://raw.githubusercontent.com/hassanvfx/kie-api-python/main/docs/kie-ai/raw/veo3-api/generate-veo-3-video.md)
- **[c21]** 'Failed tasks are not charged' and 'pre-deducted credits will be automatically returned' confirmed (kie.ai/getting-started FAQ snippets); 'credits do not expire' confirmed; absence of a cost-preflight endpoint confirmed (none in llms.txt). The community-adapter part is a misreading: BuildersGate's kie.py does NOT classify 501 as billed or 500 as unknown - its _http.is_billing() only flags 402 or 'insufficient credit' text (i.e. a billing ERROR), and its 500/501 help strings make no charge statement. The real evidence that failed/stuck tasks are sometimes charged is Trustpilot reviews ('generation reaches 99% and hangs, yet it consumes credits'). Also: creditsConsumed is not documented on any mirrored page; BuildersGate/elibarnett observe it on the market jobs record only, and Suno records lack it (balance delta needed). (https://raw.githubusercontent.com/Thepizzapie/BuildersGate/main/src/bgate_adapters/_http.py)

### Additional findings

## Additional findings (things the 21 claims do not cover, or that changed in mid/late 2026)

**Method note.** kie.ai, docs.kie.ai, api.kie.ai, web.archive.org, help.openai.com, developers.openai.com, fal.ai and the review blogs are all egress-blocked here. Primary evidence used: (1) the verbatim docs.kie.ai mirror in `hassanvfx/kie-api-python/docs/kie-ai/raw/**` (llms.txt + every page as OpenAPI-markdown; committed 2026-06-06, so ~3 months old), (2) `felores/kie-cli-mcp/docs/**` contracts (verified 2026-08-22..25), (3) the Nomi live-wire doc audit dated 2026-09-02, (4) elibarnett/kie-mcp `data/pricing.mjs` drift-watch through 2026-08-26, (5) registry.npmjs.org / pypi.org, (6) search-engine snippets of live docs.kie.ai / kie.ai pages. Nothing below is from a live fetch of Kie's own hosts.

### Contract details missing from the report
- **Sub-keys and per-key caps.** Getting Started: keys can carry hourly/daily/total usage caps and an IP whitelist. Kling 3.0 and Seedance 2 pages document body code **433 "Request Limit - Sub-key Usage Exceeds Limit"** - so Kie has parent/sub API keys; add 433 to the error table (BuildersGate: "use the parent key or raise the sub-key's cap"). 4o also documents **550 "Connection Denied"**.
- **Webhook signing is opt-in.** Headers `X-Webhook-Timestamp` / `X-Webhook-Signature` are only attached "when you enable the webhookHmacKey feature in the settings page". The official sample reads `req.body.data.task_id` while jobs/Veo/4o payloads use `data.taskId` (Runway uses `task_id`) - normalise both before computing `taskId + "." + timestamp`. No replay window is specified; enforce your own.
- **Callback retry policy is uniform** across Flux/Runway/4o/Veo/Suno pages: 15 s response timeout, stop after 3 consecutive failures, same taskId may be delivered more than once, "return 200 as soon as possible and process asynchronously".
- **`asset://{assetId}` references.** Seedance 2 accepts `asset://asset-2026...` in `first_frame_url`, `last_frame_url`, `reference_image_urls`, `reference_video_urls`, `reference_audio_urls`. No asset-creation endpoint is in llms.txt (likely the Playground asset library), but it means a media-id abstraction is at least partly native.
- **Upload API response shape is inconsistent** between the quickstart (`fileId, fileUrl, downloadUrl, expiresAt`) and the per-endpoint pages (`filePath, downloadUrl, uploadedAt`); rely only on `data.downloadUrl`. Retention text says 3 days in one place and 24 h in another (felores). Cloudflare browser-integrity rule 1010 returns HTTP 403 on `kieai.redpandaai.co` if the User-Agent looks like a bot.
- **`creditsConsumed` is undocumented** in the mirrored pages but is observed on the market `recordInfo` record (BuildersGate, elibarnett); Suno records do not carry it - measure balance before/after.
- **Veo specifics:** 4K goes through `POST /api/v1/veo/get-4k-video` (own callback page) and costs "approximately 2x the credits of a Fast video"; extension is `POST /api/v1/veo/extend`; record returns `resultUrls`, `fullResultUrls`, `originUrls`, `resolution`; `fallbackFlag` is now labelled a legacy field; `enableFallback` fallback videos are 1080p 16:9 and cannot be upscaled; REFERENCE_2_VIDEO now works on Fast **and Lite** (live docs). Clips are capped at 8 s.
- **Sora:** `upload_method` is marked *required* in the schema (default `s3`; `oss` for China). All Sora slugs still appear in docs, but OpenAI removes the Videos API on **2026-09-24** - 19 days from the report date - and Kie has published nothing about a replacement route.
- **Kling naming has forked:** legacy `kling-3.0/video` (mode/sound/multi_shots) coexists with `kling-3.0-omni/{text-to-video,image-to-video,reference-to-video,transformation}` (resolution 720p/1080p/4K, `audio`, `customize_multi_shots`/`prefer_multi_shots` which are mutually exclusive and should be sent explicitly `false` for single-shot; i2v uses `aspect_ratio: "auto"`), plus `kling/v3-turbo-*`. Nomi's 2026-09-02 audit had to migrate its mappings ("DRIFT -> fixed").
- **MiniMax H3 field casing is snake_case on the wire** (`first_frame_url`, `last_frame_url`, `reference_image_urls`, `aspect_ratio`, per felores' payload mapping and Nomi's wire list). The report's "note camelCase here" describes felores' MCP tool arguments, not Kie's API - a bug waiting to happen.
- **Seedance 2:** `return_last_frame` is marked `deprecated` on the 2.0 page; Seedance 2.5 accepts an undocumented `extension_task_id` (semantic continuation only, no frame continuity) and offers native 4K.
- **Suno:** omitting `callBackUrl` returns HTTP 200 `{"code":422,"msg":"Please enter callBackUrl."}`; `V3_5` is accepted by some sibling endpoints; docs never state how many tracks a call returns; `CALLBACK_EXCEPTION` is terminal but the audio usually rendered and was charged - re-read the record instead of treating it as failure.
- **Chat/LLM models ride the same market API:** llms.txt lists `market/chat/gpt-5-2|5-4|5-5`, `market/claude/claude-opus-4-6|sonnet-4-6|...`, `market/gemini/gemini-3-1-pro|3-flash|...`, `market/codex/gpt-codex` (OpenAI-compatible), alongside the Claude Code proxy.

### Pricing movements observed Jun-Aug 2026 (elibarnett drift-watch unless noted)
- Veo 3 Fast 80 -> **60** credits/8 s ($0.30), Quality 400 -> **250** ($1.25), Fallback 300 -> 100 (Kie pricing update, Skool). The report's $0.40/$2.00 marketing figures are stale.
- Increases: `qwen/*` 3 -> 4 cr; `wan/2-7-image` 4 -> 4.8, `wan/2-7-image-pro` 8 -> 12 (2026-07-27); `wan/2-5-*` 3 -> 12 cr/s; `grok-imagine/upscale` 5 -> 10.
- Decreases: `bytedance/seedance-2-mini` cut sharply (720p 20.5 -> 8.2 cr/s; 480p 3.8) on 2026-08-26.
- Newly published tiers 2026-08-26: Wan 3.0 8/16/32 cr/s (billed on input+output duration), Wan 3.0 Prime 12.2/25.2/50.4, Kling 3.0 Omni 14-67 cr/s, Seedream 5 Pro 7/14 cr (+0.5 per extra input image), Qwen3 4.8 / Pro 6.4-12.
- Seedance 2.5 was launched **unpriced** (July 2026) and only got a rate card in August (480p 28, 720p 63 cr/s; lower with video input) - prices can lag launches by weeks, so reconcile against `creditsConsumed`.
- Nano Banana 2 is $0.04/$0.06/$0.09 (8/12/18 cr) per Kie's page; elibarnett's 4-credit entry is wrong/stale.

### Ecosystem / status changes
- `@felores/kie-ai-mcp-server` jumped 3.6.0 -> 4.0.0 -> 5.0.0 between 2026-07-23 and 2026-08-23 (breaking releases); elibarnett `kie-mcp` is at 5.1.0 (2026-08-31). Pin versions.
- Still **no official SDK, Postman collection, or MCP** from Kie (PyPI/npm probes 404; nothing on kie.ai).
- Midjourney: still documented (`docs.kie.ai/mj-api/*` indexed) and still wired in felores (added 2026-08-25) despite the 2025 takedown reports; felores ships `midjourney_generate` in its example disabled-tools list.
- Corporate: INNOLEAP AI LLC (co-operator) is a defendant in *Robbins Research International v. InnoLeap AI LLC* (S.D. Cal., filed June 2025) - relevant to the legal-posture section.
- Suno announced a **curated partner API program** (intake form, July 2026) - if Suno formalises partners, unofficial resellers like Kie could be cut off; no public API exists as of Sept 2026.

### Open items I could not close
- Live per-model credit table on kie.ai/pricing (blocked): Flux Kontext 50/100 cr, Topaz video 8 cr flat, Suno 10-11 cr, ElevenLabs 12/6 cr, Kling 12 cr/s remain community-sourced.
- Whether `asset://` ids can be created via API.
- Whether Kie will re-route `sora-*` after 2026-09-24.
