<!-- Research report generated 2026-09-05 by an autonomous research agent; sources are cited inline. Facts marked (unverified) were not confirmed against primary sources. -->

# Higgsfield (higgsfield.ai): product, pricing, public API, MCP, model provenance, company
Research snapshot: 2026-09-05. Written for a team building an open alternative. Facts come from public pages, public tool descriptions and published SDKs.

## 0. Sourcing notes
- **Primary (P):** Higgsfield's public MCP tool descriptions and catalog responses (`show_plans_and_credits`, `models_explore`, `presets_show`, `apps_search`, `get_workflow_instructions`, `shorts_studio_list_presets`, `list_website_categories`, `show_marketing_studio_v2`); GitHub raw files of `higgsfield-ai/*`; npm registry; PyPI.
- **Secondary (S):** search-result snippets (marked "snippet"), higgsfield.ai, its help center, blog, Wikipedia, PR Newswire, Sacra, Trustpilot, BBB, third-party pricing pages. The sandbox egress proxy blocked direct fetches of higgsfield.ai, docs.higgsfield.ai, platform/cloud.higgsfield.ai, Wikipedia, WaveSpeed, Segmind, archive.org and nearly every third-party blog, so every S fact below comes from a search snippet unless stated.
- Anything from memory only is marked **(unverified)**.

---

## 1. Web app anatomy

Higgsfield in Sept 2026 is a multi-studio "AI-native creative suite" (site tagline, snippet of https://higgsfield.ai/). The MCP's own website-category list (P, `list_website_categories`) is a good map of how Higgsfield itself groups its product: Viral Trends (effects/presets), Ads & Marketing (Marketing Studio, URL-to-Ad, Ad Reference), UGC & Social (Shorts Studio, Personal Clipper, Explainer), Cinematic (Cinema Studio, Originals, storyboard), Characters & Avatars (Soul ID, Photodump, Face Swap, Character Swap), Product & E-commerce, Portrait & Lifestyle.

### 1.1 Surface-by-surface

| Surface | What the user does / inputs → outputs | Notable mechanics (source) |
|---|---|---|
| **Create Image** (`/image/soul-v2`, `/create/image?model=…`) | Prompt → 1-4 images. Inputs: prompt, model, aspect ratio, resolution/quality, reference images, Soul ID, folder. | Prompt textbox (`id=hf:tour-image-prompt`); Generate button shows cost or "N free gens left"; results land in a history grid ~15 s later (Playwright automation gist, S). Reference slots per model: Nano Banana Pro/2, Seedream, GPT Image up to 14 refs; Soul 2.0 max 1 ref; Nano Banana 2 accepts a `mask` for inpaint; `image_auto` router picks a model (P, `models_explore`). Batch: up to 4 results per press (open-higgsfield README, S). Aspect ratios up to 21:9; `auto` on some models (P). |
| **Create Video** (`/create/video?model=seedance_2_0`) | Prompt + optional start/end frame / reference images, videos, audio → clip 3-30 s. | Lexical contenteditable prompt editor; upload dialog with an "Image Generations" tab so images generated on-site can be used without re-upload (gist, S). Per-model controls exposed in P catalog: duration (Seedance 2.5 4-30 s, Wan 3.0 2-30 s or "smart" −1 billed as 10 s), resolution 480p→4K, `mode` std/fast, `generate_audio`, `genre` (auto/action/horror/comedy/noir/drama/epic), `bitrate_mode`, `video_edit`/`video_extension` modes, `batch_size` 1-4 (MiniMax H3). Credit cost is printed on the Generate button (gist, S). |
| **Soul / Soul ID** | Soul 2.0 (`soul_2`/`soul_v2`): "Realistic UGC, fashion editorial and character generation", quality 1.5k/2k, optional `soul_id`. Soul Cinema, Soul Cast (16:9 identity with `budget` 10-500), Soul Location. Soul ID: upload 5-20 face photos (help center says min 20 in one version; ~3-10 min training) → reusable identity across Soul V2/Cinema (snippets; P tool text says "5-20 photos, ~10 min, ONE person"). | Soul ID training cost observed at **25 credits** (2026). Soul V1 images cost 0.25 credits, Soul V2 0.12 or 0 under "free gens" (P). API exposes 70+ Soul style presets via `/v1/text2image/soul-styles` (SDK source, P). |
| **Cinema Studio** (image 2.5 up to 4K; video v2 / 3.0 / 3.5) | Cinematic stills and 3-15 s clips with camera-rig controls. | UI: camera body (DXL2, RED, Sony, IMAX, ARRI, Panavision), spherical vs anamorphic lenses (Petzval, Canon K35, Panavision C…), focal length 12-135 mm, aperture, sensor profile VHS/Film/Digital; global Genre/Style/Lighting/Color palette/Camera MoveSet; per-shot settings; "Director Mode" stacks up to 3 camera moves per shot (help-center + guide snippets). P params: `genre`, `mode` pro/std, `sound`, `speedramp` (auto/linear/slowmo/speedup/impact), `multi_shots` + `multi_shot_mode`, `cfg_scale`, `preset_id`; 3.0 adds resolution 480p-4k + `generate_audio`; CLI lists a 3.5 with 15 s and camera/color/lighting styles (MODELS.md, P). |
| **Marketing Studio / DTC Ads** | Product URL or image (+ brand kit, avatar) → finished ad image/video. | Brand kit auto-extracted from a website URL (logo, colours, fonts, tone) (help-center snippet). Products: URL extraction, up to 4 `product_ids` (P). Avatars: 40+ presets or custom via Soul ID, max 1 per video (P). Formats (P, `show_marketing_studio_v2`): UGC → Talking head; Product shot → With model / Standalone; Motion → 2D product motion / Hypermotion / Mixed media / SaaS; Ads; Posters; Marketplace; **986 presets** in the gallery. Hooks ("what") and Settings ("where") only for UGC/Tutorial/Unboxing/Review/Try-On presets; `ad_reference_id` recreates an analysed reference ad (mutually exclusive with hooks) (P). Video 12-15 s, 480p-1080p; `ms_image` requires `style_id`, `quality` low/med/high, `batch_size` 1-20, up to 14 refs (P). Ad Multiplier: N independently edited versions of one 4-30 s video, "powered by Seedance 2.5" (P). Observed cost: Marketing Studio Image 2 cr, Video 40 cr (P). |
| **Popcorn (storyboard)** | Prompt + refs → 4/6/8 consistent frames; edit frames individually; frame-by-frame visual memory (blog snippets). "Shots" turns one image into a storyboard (blog snippet). | Observed "Storyboard" 4 credits and "Higgsfield Popcorn" 0 credits (observed per-generation credits, 2026). |
| **Canvas** | Node-based infinite board: prompt nodes → generation nodes for any model; run in parallel, compare side-by-side, save as reusable template, real-time team collaboration and in-canvas chat (help-center + X snippets; live ~Apr 2026). | Every model runs inside the graph (Soul 2.0, Seedance 2.0, Kling 3.0, Wan 2.7, Veo 3.1, Nano Banana Pro, GPT Image 2) (snippet). |
| **Presets / Effects / Motions / Camera controls** | Upload image → pick preset → 5 s clip. Categories: Effects, Basic Camera Control, Epic Camera Control, Catch the Pulse, New & Trending (help-center snippet); marketing claims 50+/100+ presets. | P: `presets_show` returns 63 presets (two families: `job_set_chain_preset` such as EARTH ZOOM, ORBIT 360, STICKER PEEL, and `superhero-gen-preset` such as Earth zoom in/out, Disintegration); `higgsfield_preset` model takes `preset_id`, 1 image, 16:9/9:16/1:1. DoP = Higgsfield's image-to-video motion model behind camera presets (snippet). |
| **Genjutsu** | Reference video (3-30 s) + up to 30-40 reference images → re-cast video. Two modes: Motion Transfer (keep acting/camera/edit, rebuild cast/world) and Object Swap (replace one element) (snippets; launched **1 Sep 2026**). | P ids `hf_mult_motion_control` and `hf_mult_replace_object`, `resolution` 480p/720p/1080p, inputs `image_references` + `video_references`. Launch promo: 70% off, 7 days unlimited (snippet). |
| **Lipsync / Speak / Audio** | Lipsync Studio (under Video): image-to-video and video-to-video talking clips (help-center snippet). Audio: TTS, voice clone, voice change, dubbing (blog snippet + P tools `create_voice`, `voice_change`, `dubbing`). | P: `sync_so` "Sync Lipsync 3" with `sync_mode` bounce/loop/cut_off/silence/remap; `text2speech_v2` with engine `variant` elevenlabs/minimax/seed_speech/vibe_voice/cozy_voice; Seed Audio 1.0; Qwen Audio 3.0 TTS Flash. API: `/v1/speak/higgsfield` (SDK README, P). |
| **Characters / Elements** | Elements = reusable characters/environments/props created instantly from one image, referenced as `@name` in prompts; work with Nano Banana Pro/2, GPT Image 2, Seedream 4.5/5 lite, Cinema Studio 2.5/Video, Seedance 2.0, Kling 3.0, not Soul. Soul = trained identity (P tool text). | `show_characters`, `show_reference_elements` (P). |
| **Upscale / Enhance** | Image: Topaz (Standard V2, Low Resolution V2, CGI, High Fidelity V2, Text Refine; generative Standard MAX/Redefine/Recovery), ByteDance 2K/4K, background remover, Outpaint (FLUX.2 Pro, per-side px), Reframe. Video: Topaz 1080p/2160p + frame interpolation, ByteDance 1080p/2K/4K 24-60 fps with content presets, Video Upscale, Deflicker, SAM 3 background removal (P catalog). "Flux 3.0 Video Upscale" to 4K (snippet). | Topaz Image observed 2 credits (P). |
| **Explore / community** | Public feed (no login) sorted Hot / Rising / Controversial; "Recreate" opens the generation panel pre-loaded with prompt + model; likes/comments/karma; "Higgsfield Chat/Collab" shared projects (snippets). | Apps appear under All Apps / Community / Made by Higgsfield tabs (snippet). |
| **Projects / Assets / Folders / Workspaces** | `/asset/all` personal library; folders (`folder_id` on most jobs, P); history grid; workspaces private vs shared/team with per-workspace plan and credits (P `list_workspaces`, `select_workspace`). | |
| **Apps marketplace** (`/apps`, `/supercomputer/apps`) | No-code apps built in Supercomputer, published to Explore, remixable; $100k App Contest at launch; Stripe-powered creator payouts (US/EU/UK/KR/JP/CA) (snippets, Jan 2026). | P `apps_search` → "Match Cut + Tracelab" app with 28 actions (facecut, logocut, VHS, thermal, CRT…), `manifest_revision v3`. |
| **Website / App builder** (Supercomputer "App Builder") | Prompt → deployed full-stack site: front end, back end, DB, auth, storage, integrations (snippet). Types: `website` (standalone, Tailwind), `app` (Sign in with Higgsfield + fnf SDK, Quanta template), `game` (browser game with multiplayer rooms) (P workflow). React 19 + Cloudflare Workers/D1/R2/KV (skills README, P). | 8 categories required at create (P). CLI `higgsfield website create --type app --category <slug> --template studio` (P). |
| **Supercomputer** | Agent with memory, connectors, scheduled jobs, storage, sandbox; modes Efficient (fast) vs Smart (complex) (snippets). | Ultra plan: 5 GB storage, up to 10 scheduled jobs (P pricing config). GLM-5.3 Flash surfaced there Aug 2026 (snippet). |
| **Shorts Studio** | Upload own clip → restyled short; 44 presets or custom from a photo/video moodboard; "powered by Gemini Omni Flash" (snippets). | P: presets paginated 8/page (Bold Urban, Claymation, Marker Scribble…), `can_create_preset`. |
| **Clipify / Personal Clipper** | YouTube URL → 1-20 clips with burned-in subtitles (P: `clips_num`, aspect 9:16/1:1/16:9, 14 subtitle fonts, highlight hex, position, case, face-tracking crop, `segment_seconds`). Launched May 2026 in Supercomputer and via MCP in Claude/Cursor/Manus (snippets). | |
| **Virality Predictor** | Upload/select a video → Hook Score, Hold Rate, "brain heatmap", predicted engagement (snippets; ~Apr 2026). | CLI model id `brain_activity` (MODELS.md, P). |
| Other | TikTok connect/publish + trending music (P tools), video analysis, 3D scene builder (Blender), AutoSprite sprite sheets, 3D generation (Meshy/Tripo/Hunyuan/SAM 3) (P). | |

### 1.2 UI screens/components to replicate
1. **Global shell:** left nav (Image, Video, Studios, Canvas, Apps, Explore, Assets, Supercomputer), workspace switcher, credit balance + "free gens" counter, upgrade CTA.
2. **Generate panel (image):** model picker (searchable, grouped own/third-party, "unlimited" badge), prompt box, aspect-ratio chips (1:1…21:9, auto), resolution/quality select, reference-slot strip (N slots per model, mask slot), Soul/Element picker, batch count (1-4), cost/free-gens label on Generate.
3. **Generate panel (video):** as above plus start/end-frame slots, reference video/audio slots, duration slider, resolution, std/fast, audio toggle, genre, speed-ramp, multi-shot editor.
4. **History/results grid:** masonry grid with skeleton tiles on submit, 3-4 s polling, per-tile actions (download, recreate, animate, upscale, add to folder, favourite), failed/NSFW tiles.
5. **Upload dialog:** tabs Upload / Image Generations / Assets; URL import.
6. **Assets library:** all/images/videos/favourites, folders, search.
7. **Soul ID trainer:** photo drop (5-20), name, progress state (not_ready/queued/in_progress/completed/failed).
8. **Cinema Studio:** rig panel (camera/lens/focal/aperture/sensor), global look panel, shot list with per-shot moves.
9. **Marketing Studio:** brand-kit editor, product importer (URL), avatar gallery, format tabs + 986-preset grid, hook/setting pickers, ad-reference analyser, results.
10. **Popcorn:** frame count selector, per-frame prompt/edit, reference strip.
11. **Canvas:** node editor (prompt/gen/media nodes), run/compare, template save, presence/chat.
12. **Presets browser:** category tabs, video-preview cards, one-click animate.
13. **Genjutsu:** reference video slot + multi-image reference strip, mode toggle (motion transfer / object swap), resolution.
14. **Lipsync/Audio studio:** voice list + clone, TTS engine select, video+audio sync mode.
15. **Upscale/Enhance:** engine select (Topaz/ByteDance), size/variant sliders, face enhancement.
16. **Explore feed:** Hot/Rising/Controversial tabs, Recreate button, app tabs.
17. **Apps:** app cards, app runner, publish flow.
18. **Website builder:** chat-to-site, type/category picker, deploy/publish, repo/secrets/db panels.
19. **Shorts Studio / Clipper / Virality Predictor:** preset picker; URL → clip list with subtitle styling; score card with heatmap.
20. **Billing:** plan cards (monthly/annual/18-mo/2-yr), top-up packs, auto-refill, transactions list.

---

## 2. Pricing

### 2.1 Plan ladder (individual)
Higgsfield renamed tiers at least twice in 2026 (Basic/Pro/Ultimate/Creator → Starter/Plus/Ultra/Business early 2026; some sources report a later Basic/Pro/Max relabel) (snippets, Buttondown/Creatify). The **live MCP pricing config on 2026-09-05 (P)** describes the upgrade widget as "Plus + Ultra" and shows:

| Plan | Monthly | Annual (per mo) | Credits / mo | Concurrency | Notes |
|---|---|---|---|---|---|
| Free | $0 | - | 0 | - | watermark; no commercial rights (snippets) |
| Starter | $19 (older reports $15) | ~$15 | 270 | 2 video / 4 image | verified live 2026-08-19 by a third party (snippet) |
| Plus | $59 | $47 (first year) | 1,200 | ~6 video / 8 image (May-2026 report) | the backend plan id `ultimate` maps to the 1,200-credit Plus tier (P) |
| **Ultra** | $129 | **$99** (23% off, "$360 saved") | **3,000** | **8 video / 8 image** | "Access to all models & features", all Seedance models, Supercomputer (5 GB, Efficient+Smart, 10 scheduled jobs), "unlimited marketplace", early access, "Lowest cost per credit, 70% cheaper" (P) |

Billing periods in config: monthly, annual, eighteen_month, two_year (P). Tooltip: 3,000 credits ≈ "~12000 images or ~500 videos or ~100 character generations", "= 1,500 Nano Banana Pro generations, ~500 Kling 3.0 videos" (P).

Team/Business (snippets, conflicting): Team $79/seat monthly / $69 annual, 2-9 seats, ~1,000-1,500 credits/seat pooled, 16 video/16 image parallel; Business $62/seat/mo annual with 1,500 credits/seat; Scale $150/seat/mo, 5-15 seats, 12,500 pooled credits. A competing ladder "Basic $5-9 / 70-120 cr, Pro $29 / 600-900 cr, Max $79 / 1,800-5,400 cr" appears in Aug-2026 snippets, treat as regional/A-B or stale **(conflict, unresolved)**.

### 2.2 "Unlimited" mechanics (P, Ultra config, "Buy until Sep 10", web only)
- **365-day unlimited** (1 year after purchase, on web): Seedream 5.0 Lite (2K/3K), Flux.2 Pro (1K), Seedream 4.5 (2K/4K), Nano Banana, Kling O1 Image, GPT Image.
- **Free gens pool:** Soul V2 & Soul Cinema Studio, 5,000 free gens (monthly plan) / 10,000 (annual).
- **7-day unlimited** (7 days after purchase): Nano Banana Pro (1K/2K), Nano Banana 2 (1K/2K); annual Ultra adds **Kling 3.0 (720p/5s)**.
- Seedance 2.0 and 2.0 Fast: "FULL ACCESS" (credit-billed).
- Catalog flag `supports_unlim` marks models eligible for trial/unlimited: Soul 2.0, GPT Image 2, Nano Banana/Pro/2, Seedream 4.5/5 Lite/5 Pro, FLUX.2, Kling O1 Image, Seedance 2.0/Mini, Kling 3.0, Gemini Omni Flash, Wan 2.7, Seed Audio, Mirelo, Inworld TTS, TTS V2 (P).
- Older help-center text: unlimited/free gens apply only on higgsfield.ai; MCP/CLI/ChatGPT deduct standard credits (snippet). Newer "Unlimited MCP" blog (July 2026): unlimited also works inside Claude/ChatGPT (audio not in ChatGPT) (snippet). Observed: Nano Banana Pro billed 0 credits during Feb-2026 promo, 2 credits otherwise (P).
- Subscription credits are zeroed at renewal ("Subscription Credits Reset" deduct immediately before each grant, P) → no rollover.

### 2.3 Top-ups, auto-refill, conversion (P, 2026-09-05)
| Pack | Price | List | Discount | credits/$ | $/credit |
|---|---|---|---|---|---|
| 500 | $29.41 | $42.50 | 31% | 17 | $0.0588 |
| 1,000 | $55.56 | $85.00 | 35% | 18 | $0.0556 |
| 2,000 | $105.26 | $170.00 | 38% | 19 | $0.0526 |
| 4,000 (most popular) | $210.53 | $340.00 | 38% | 19 | $0.0526 |
Top-ups expire after **90 days**. Auto-refill: threshold 150 credits, options 1k/2k/3k/5k/10k, **20 credits per $** ($0.05/credit), 90-day expiry.
Subscription $/credit: Ultra annual $0.033, Ultra monthly $0.043, Plus annual $0.039, Plus monthly $0.049, Starter $0.070. **Working conversion: 1 credit ≈ $0.033 (best) to $0.05 (marginal); list price $0.085.**

Trial (P, tool contract): a **3-day $0 Plus trial with MCP-only credits**, card required, auto-charges unless cancelled ("cancel auto-renewal" tool). July 2026 promo: 24-hour free unlimited trial across 11 image, 5 audio, 7 video models (snippet).
Refunds (help-center/ToS snippets): initial purchase refundable within 7 days if no credits used, up to 6% fee; auto-renewals never refundable; ToS/Privacy update effective **27 Aug 2026**.

### 2.4 Per-generation credit costs
**Observed per-generation credits (2026):**

| Model | Credits observed | Notes |
|---|---|---|
| Nano Banana Pro | 2 | stable Feb-Sep 2026 (0 during promo) |
| Nano Banana 2 | 1.5 (2 at higher res) | |
| GPT Image 2.0 | 7 (Apr-Jun), **8.5** (Sep 3), 2 (low tier) | |
| GPT Image 1.5 | 6 | |
| Higgsfield Soul (v1) / Soul V2 | 0.25 / 0.12 or 0 | free-gens pool |
| Seedream 4.5 | 1 (0 when unlimited) | |
| FLUX.2 Pro | 0 (unlimited) | |
| Flux Kontext | 1.5 | |
| Recraft V4.1 | 1.25 | |
| Topaz Image (upscale) | 2 | |
| Marketing Studio Image / Video | 2 / 40 | |
| Storyboard (Popcorn) | 4 | |
| Soul ID training | 25 | |
| Kling 3.0 Turbo | 7.5 · 9 · 13.5 · 15 · 22.5 | duration/res dependent |
| Kling v3.0 (std/pro/4k) | 5.25 · 10.5 · 17.5 · 20 · 26.25 · 90 | |
| Kling 2.1 | 20 | |
| Seedance 2.0 | 36 · 42 · 44 · 45 · 49.5 · 52.5 · 54 · 55 · 58.5 · 67.5 · 75 · 88 · 135 · 165 | Mini: 25 |
| Seedance 2.5 | 75 | one job, params not logged |
| Google Veo 3 | 58 | |
| Google Veo 3.1 Lite | 8 | |
| Gemini Omni Flash | 30 | |
| Cinematic Studio Video V2 / 3.0 | 7.5 / 25 | |

**Secondary (snippets):** Kling 3.0 ≈6 cr per 5 s (std), ≈14 cr per 8 s; Seedance 2.0 **22 cr at 720p/5 s, 45 cr at 1080p/5 s**, ~90 cr for 15 s; Veo 3.1 Fast **40 cr for 8 s 720p**; Veo 3 Fast 22 cr; Veo 3.1 / Sora 2 40-70 cr; Topaz upscales from 3 cr; Kling 2.5 Turbo ~3 cr, Kling 2.6 / Wan 2.6 / Hailuo 02 ~5 cr; MiniMax H3 "$0.074/s at 720p" (single snippet, **unverified**). Not captured: Seedream 5 Pro, Wan 3.0, MiniMax H3 credits, ElevenLabs TTS credits, 3D credits (open questions).

### 2.5 Higgsfield vs fal.ai / Kie.ai (USD; Higgsfield at $0.033-$0.05 per credit)
| Model / job | Higgsfield credits → USD | fal.ai list | Kie.ai list | Verdict |
|---|---|---|---|---|
| Nano Banana Pro, 1 image (2K) | 2 cr → **$0.07-0.10** (or $0 on 7-day unlimited) | $0.15 | - | Higgsfield 1.5-2.3× cheaper |
| Seedream 5 Pro, 1 image | not captured (Seedream 4.5 = 1 cr → $0.03-0.05) | (unverified) | - | likely parity/cheaper |
| GPT Image 2, 1 image (2K) | 7-8.5 cr → **$0.23-0.43** | (unverified) | - | premium vs typical $0.04-0.25 OpenAI tiers (unverified) |
| Kling 3.0 pro 5 s (+audio) | ~17.5-20 cr → **$0.58-1.00** | $0.56 (+audio $0.84) | std $0.06/s → $0.30 | ≈ parity with fal; 2-3× Kie std |
| Kling 3.0 std 5 s | ~5.25-6 cr → $0.17-0.30 | - | $0.30 | parity/cheaper |
| Seedance 2.5 720p 5 s | 22 cr (2.0 figure) → **$0.73-1.10**; one observed 2.5 job 75 cr → $2.48-3.75 | ≈$0.47/s → $2.35 | $0.19-0.32/s → $0.95-1.60 | Higgsfield 2-3× cheaper than fal at 720p |
| Veo 3.1 fast 8 s | 40 cr → **$1.32-2.00** (Lite: 8 cr → $0.26-0.40) | $0.10-0.15/s → $0.80-1.20 | $0.30 | Higgsfield 1.1-2.5× fal, **4-7× Kie** |
| Wan 3.0 5 s | not captured | (unverified) | - | open |
| MiniMax H3 5 s | not captured (snippet $0.37/5 s unverified) | (unverified) | - | open |
| Topaz image upscale | 2-3 cr → $0.07-0.15 | (unverified) | - | open |
| ElevenLabs TTS | not captured | - | - | open |

**Three biggest gaps:** (1) Veo 3.1 fast, Higgsfield ≈$1.3-2.0 vs Kie $0.30 (4-7×); (2) Nano Banana Pro, Higgsfield ≈$0.07-0.10 (or $0) vs fal $0.15 (Higgsfield cheaper, and the 7-day unlimited promo makes it effectively free); (3) Seedance 2.x 720p, Higgsfield ≈$0.73-1.10 vs fal ≈$2.35 (Higgsfield 2-3× cheaper), though observed 2.5 jobs reached 75 cr.

---

## 3. Public developer API

Hosts (P, SDK sources): **`https://platform.higgsfield.ai`** is the API base URL; keys are issued at **cloud.higgsfield.ai**; docs at docs.higgsfield.ai (blocked here; snippet: "submit a request to a model endpoint, then poll or receive a webhook").

Auth: v2 SDK sends `Authorization: Key KEY_ID:KEY_SECRET` (env `HF_CREDENTIALS` or `HF_API_KEY`+`HF_API_SECRET`; Python uses `HF_KEY="key:secret"`); v1 SDK used headers `hf-api-key` / `hf-secret` (P, `src/client.ts`, `src/v2/client.ts`).

Endpoints (P unless noted):
- `POST /{endpoint}`, generic submit; endpoint names are model paths: `/v1/text2image/soul`, `/v1/image2video/dop`, `/v1/speak/higgsfield`, `flux-pro/kontext/max/text-to-image`, `bytedance/seedream/v4/text-to-image` (READMEs). Body: `{ params: {...}, webhook?: {url, secret} }` (v1) / `{ input: {...} }` (v2). Optional query `?hf_webhook=<url>` (v2).
- `GET /requests/{request_id}/status`, poll. Response `{status, request_id, status_url, cancel_url, images[{url}], video{url}}`; statuses `queued | in_progress | completed | failed | nsfw` (+`canceled` in v1 JobStatus). Results carry `raw` and `min` URLs.
- `POST /v1/custom-references` (create Soul ID: `{name, input_images:[{type:"image_url", image_url}]}`), `GET /v1/custom-references/list?page&page_size`, `GET /v1/custom-references/{id}`; SoulId statuses `not_ready|queued|in_progress|completed|failed`.
- `GET /v1/motions` (DoP motion presets), `GET /v1/text2image/soul-styles` (70+ styles).
- `POST /files/generate-upload-url {content_type}` → `{upload_url, public_url}` (presign → PUT → use public URL).
- Python client: `submit / status / result / cancel / subscribe` (+async), `upload / upload_file / upload_image`, `webhook_url` param.
- Errors: 401 AuthenticationError, 403 NotEnoughCreditsError, 422 ValidationError, 400 BadInputError; `TimeoutError` after `maxPollTime` (default 300 s, poll 2 s, timeout 120 s, 3 retries).
- Rate limits: **not documented anywhere reachable** (open question). Cost endpoint: not in SDKs; the official CLI has `higgsfield generate cost <model> [params]` and `generate cost workflow <name>` (P README), so a cost-estimation endpoint exists behind the CLI. The "jobs/submit|cost|cancel, media presign/confirm" naming in the brief matches the CLI/MCP (`media_upload → PUT → media_confirm`, `media_import_url`, `jobs_wait`) rather than any documented public REST path (open question).

SDKs / tooling (P): `@higgsfield/client` 0.2.1 (npm, 24 Nov 2025; v1 deprecated, v2 server-only, blocks browsers); `higgsfield-client` 0.1.0 (PyPI, 17 Nov 2025; Python ≥3.8); `@higgsfield/cli` 1.1.24 (npm 29 Aug 2026; Homebrew tap; curl installer; MIT) with `auth login` (short-lived browser tokens), `generate create/get/wait/list/cost`, `model list` (23 image / 22 video / 5 3D / 5 audio incl. Virality Predictor `brain_activity`, explainer assembler), `workflow`, `upload`, `voices list`, `soul-id create --soul-2 --image …`, `website create/deploy`, `workspace list/select`, `account`, `--json`; `higgsfield-ai/skills` v0.12.0 (9 agent skills for Claude Code/Cursor/Codex); `higgsfield-ai/cursor-plugin`; unofficial `higgsfield-cli` on PyPI (cookie-based, not the API). Community MCP `geopopos/geo_higgsfield_ai_mcp` wraps Soul/DoP/Speak/characters via the same API.

API pricing: per-request credit billing on the same balance; third-party claims that API per-call pricing is lower than subscription credits **(unverified)**. Marketplace hosting of Higgsfield-own models: **WaveSpeedAI** `higgsfield/soul` image-to-image from **$0.090/run** and `higgsfield/dop` image-to-video from **$0.125/video (5 s)** (snippets); Segmind hosts `higgsfield-text2image-soul` (70+ styles, up to 2048×1536, prompt enhancement, `style_id`, batch) and `higgsfield-image2video` (modes lite/standard/turbo, `motion_id`, seed, start/end frame) (snippets; prices not captured); eachlabs also lists Soul (snippet).

---

## 4. Official Higgsfield MCP
- Connect: Claude.ai/Desktop → Settings → Connectors → custom connector URL **`https://mcp.higgsfield.ai/mcp`** (some guides cite `higgsfield.ai/mcp` for the web connector); Claude Code: `claude mcp add higgsfield https://mcp.higgsfield.ai/mcp`; OAuth sign-in with the Higgsfield account, no API key; ChatGPT: official Higgsfield app/plugin from the directory (no URL); also Cursor (plugin repo), Codex, OpenClaw, Hermes, Manus (snippets + P repos). Same account and credit balance everywhere.
- Widget / "Apps UI": the connector returns interactive widgets in hosts that support MCP UI, `show_plans_and_credits` "opens the combined pricing widget" (Upgrade Plan / Top-up tabs, Stripe checkout links), `media_upload_widget` is the only upload surface, `job_display` renders results, `show_marketing_studio_v2` opens the template gallery, `presets_show`, `show_characters`, `show_reference_elements`; text clients get a Markdown fallback with `[Go to Checkout](url)` links (P tool contracts).
- Trial: `free_trial` block → 3-day $0 Plus trial with **MCP-only credits**, card required, auto-charge unless cancelled; `cancel_trial_auto_renewal` tool; `trial_status`, `unlim_trial_in_mcp_active`; `models_explore(unlim=true)` lists models eligible for "free-trial unlimited generations" and the trailing "Unlim configs" lists covered resolutions/durations (P).
- Unlimited via MCP: July 2026 "Unlimited MCP", unlimited generation works inside Claude and ChatGPT (audio unlimited not in ChatGPT); earlier help-center text said MCP/CLI always deduct standard credits (snippets; timeline conflict noted).
- Personal Clipper and Marketing Studio are exposed through MCP; Higgsfield markets "Claude AI Video Generator" and "MCP for Marketers" pages (snippets).

---

## 5. Own vs third-party models
`provider_name` in the live catalog (P):
- **Higgsfield-branded:** Soul 2.0 (`soul_2`/`soul_v2`), Soul Cinema, Soul Cast, Soul Location, Cinema Studio Image 2.5, Cinema Studio Video (v1, v2, 3.0; 3.5 in CLI), Marketing Studio Image/Video, DTC Ads (`ms_image`), Image Auto (router), AutoSprite, Higgsfield Preset (preset-routed i2v), Ad Multiplier (**"powered by Seedance 2.5"**: explicit wrapper), Genjutsu (`hf_mult_*`), Text to Speech V2 (engine selector over ElevenLabs/MiniMax/Seed/Vibe/Cozy, wrapper), Personal Clipper, Virality Predictor, plus API-only DoP and Soul ID.
- **Third-party resold:** Google (Nano Banana / Pro / 2 / 2 Lite, Veo 3 / 3.1 / 3.1 Lite, Gemini Omni Flash / 1.1), OpenAI (GPT Image 2, "OpenAI Hazel"), ByteDance (Seedream 4.5 / 5.0 Lite / 5.0 Pro, Seedance 1.5 / 2.0 / 2.0 Mini / 2.5, Seed Audio, upscalers), Black Forest Labs (FLUX.2 pro/flex/max, Kontext, FLUX 3 Video), Kling (2.6, 3.0, 3.0 Turbo, O1 Image), xAI (Grok Image / 2.0, Grok Video / 1.5), Recraft V4.1, Tongyi-MAI Z Image, Hailuo/MiniMax (Hailuo 2.3, H3, H3 Max), Wan (2.6, 2.7, 3.0, 3.0 Prime), Happy Horse, Alibaba Qwen TTS, Meta SAM 3 (3D objects/body/video), Meshy (5/6/7), Tripo H3.1, Tencent Hunyuan3D v3/3.1, Topaz, Sync Lipsync 3, and **`provider_name: "FAL"`** on Sonilo Music, Mirelo SFX and Inworld TTS ("Game pipeline only").
- Upstream evidence: the explicit FAL provider tags; MiniMax H3 Max being "post-trained by fal" (snippet); Cinema Studio 3.0 and Seedance 2.0 share the identical `genre` enum, 480p-4K ladder and `generate_audio` flag (P), consistent with Cinema Studio 3.0 being a tuned/wrapped Seedance pipeline **(inference, unverified)**; Shorts Studio "powered by Gemini Omni Flash" (snippet). Higgsfield's own claim: it "develops the Soul family, DOP, Cinema Studio, Keyframes, Soul ID and Soul HEX" (snippet).

---

## 6. Company
- Founded Oct 2023, San Francisco; founders **Alex Mashrabov** (ex-Snap Generative AI director; co-founded AI Factory, acquired by Snap 2020), **Yerzat Dulat**, **Mahi de Silva** (Wikipedia/Sacra/PRN snippets).
- Funding: $8M seed, Menlo Ventures, Apr 2024; **$50M Series A, GFT Ventures, Sep 2025 @ $1.0B**; **$80M Series A extension, Accel, Jan 2026 @ $1.3B** (15M+ users, ~$200M ARR, ~85% of usage from social-media marketers); **$400M Series B, DST Global, Aug 2026 @ $5.4B** with Tribe, Goldman Sachs Growth Equity, Smash, Fifth Wall, Valor, Intel Capital, Liberty Global, Mirae, NTT DOCOMO Ventures; **$700M annualised revenue**, 30M+ users in 238 countries, US largest market (PR Newswire snippet, Aug 2026).
- Headcount: PitchBook 160 vs a data vendor's 454 (31 Jul 2026), **conflicting**.
- Positioning: "AI-native creative suite" for creators/marketers; 40+ models; agentic Supercomputer; MCP-first distribution; Stripe-powered creator marketplace (Jan 2026).
- Reliability / ToS / refunds: Trustpilot (~145-169 reviews) and BBB complaints centre on hard-to-find cancellation, annual-vs-monthly confusion, refused refunds on renewals, Discord bans (snippets); ToS + Privacy update effective 27 Aug 2026 drew backlash over content-ownership/billing wording (snippets); refund policy: 7 days, unused credits only, ≤6% fee, renewals non-refundable, sub credits don't roll over, top-ups expire 90 days.
- Recent news (2026): Canvas (Apr), Virality Predictor (Apr), Personal Clipper (May), Unlimited MCP + 24-h trial (Jul), Recraft V4.1/Styles/Utility + GLM-5.3 Flash in Supercomputer + Seedance 2.5 (Aug), Series B (Aug), Genjutsu (1 Sep), Global Film Festival deadline 3 Sep (snippets).

---

## 7. Open questions
1. Exact credit tables for Seedream 5 Pro, Wan 3.0, MiniMax H3, ElevenLabs TTS, 3D models, Genjutsu, Popcorn per-frame.
2. Whether the Basic/Pro/Max ladder ($5-9 / $29 / $79) is live for some regions or superseded; Plus concurrency today.
3. Public REST paths for cost estimation, cancel and media presign/confirm (only surfaced via CLI/MCP).
4. API rate limits and whether API calls draw from the same subscription credits or a separate developer balance.
5. Which upstream serves Cinema Studio 3.0/3.5 and Genjutsu.
6. Headcount (160 vs 454).
