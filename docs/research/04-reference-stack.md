<!-- Research report generated 2026-09-05 by autonomous research agents; sources are cited inline. Facts marked (unverified)/[M]/[U] were not confirmed against primary sources. -->

# Reference implementations and recommended application stack

Dimension report for the "own Higgsfield-like AI media studio" dossier (web app + API + async jobs + cost ledger + remote MCP server), researched 2026-09-05.

Fixed decisions taken as given: TypeScript, Next.js, Supabase (Postgres/Auth/Storage/Realtime), Vercel (team currently on Hobby), MVP = image generation/editing + video generation with references, single tenant, cost ledger, remote MCP over Streamable HTTP with auth.

Source-quality legend used below: **[P]** primary source fetched (raw GitHub mirror of official docs, npm registry, GitHub API via MCP); **[S]** search-engine snippet of a primary page that the sandbox proxy blocked (vercel.com, supabase.com, ai-sdk.dev, modelcontextprotocol.io, cloudflare, inngest, trigger.dev were all blocked for direct fetch); **[U]** from memory / unverified. Sibling reports `fal-api.md` and `kie-api.md` in this directory are referenced for provider-side facts rather than repeated.

---

## 0. Executive summary (what to build with)

| Layer | Recommendation | Why (short) |
|---|---|---|
| Framework | `next@16.3.4`, `react@19.2.8`, `typescript@7.0.2` | 16.3 went stable 2026-08-03 (npm `latest` = 16.3.4) [P]; Cache Components / `use cache` / `proxy.ts` are the 16.x model [S]. |
| UI | `tailwindcss@4.3.3`, `shadcn@4.21.0` CLI (Radix or Base UI via `--base`), `lucide-react@1.41.0`, `sonner`, `cmdk` | shadcn CLI v4 (March 2026) is the default SaaS UI stack [S]. |
| Client state / data | `@tanstack/react-query@5.102.8`, `zustand@5.0.15`, `nuqs@2.10.1`, `react-hook-form@7.87.0` + `zod@4.5.4` | Same combination the fal video-starter-kit uses [P]; zod 4 is required by `mcp-handler@2`. |
| Media UI | `media-chrome@4.19.2` (player), `react-compare-slider@4.0.0`, `react-plock@3.6.1` or CSS grid lanes (masonry), `@tanstack/react-virtual@3.14.10`, `react-dropzone@20.1.1`, `@uppy/core@6.0.0` + `@uppy/tus@6.0.0` (resumable) | Vidstack/Media Chrome/Plyr teams are merging into Video.js v10 [S]; Media Chrome is the Mux-maintained one today. |
| Provider layer | Own adapter interface (`submit / status / result / estimateCost / parseWebhook / mapMedias`) wrapping `@fal-ai/client@1.10.1` and a hand-written Kie client; optionally `ai@7.0.93` + `@ai-sdk/fal@3.0.37` for synchronous image calls only | AI SDK's `generateImage` is stable but blocking; `experimental_generateVideo` is experimental, has no webhook mode and returns bytes, unfit as the core of a webhook-driven job system [P]. |
| Async jobs | Postgres `jobs` state machine (source of truth) + provider webhooks + reconciler cron (`pg_cron` → `pg_net` → route) for MVP; `workflow@4.8.5` (Vercel Workflow DevKit, public beta) or `inngest@4.20.0` for multi-step pipelines | Hobby functions max 300 s [S]; Vercel Workflow's Hobby quota is 50k events/month [S]; both providers deliver signed webhooks (see sibling reports). |
| Realtime | Supabase Realtime broadcast from DB trigger on `jobs` (private channel per workspace) | Free plan: 200 concurrent connections, 100 msg/s, 2M msgs/month [P][S]; avoids SSE-holding functions on Vercel. |
| Storage | Supabase Storage (private buckets, TUS uploads, signed URLs, image transforms) as default; R2 as escape hatch for heavy video egress | Provider URLs expire (fal ≥7 d, Kie 14 d / 20-min signed links), copy every output at webhook time [P via sibling reports]. |
| Ledger | `pgledger`-style double-entry in SQL (accounts, transfers, entries with running balance) + `job_cost_reservations` | Pure-SQL ledger, composable, per-entry previous/current balance [P]. |
| MCP | `mcp-handler@2.1.1` + `@modelcontextprotocol/server@2.0.0` route at `/api/mcp`; `withMcpAuth` verifying **either** Supabase-issued OAuth 2.1 tokens (Supabase Auth OAuth server, beta, free on all plans) **or** hashed workspace API keys | mcp-handler 2.x serves the 2026-07-28 spec natively and falls back to 2025-era Streamable HTTP [P]. |
| Ops | `@sentry/nextjs@10.73.0` (Developer plan free, 5k errors), Axiom Personal (500 GB/mo free) via `@axiomhq/nextjs@0.4.0`, a `provider_calls` trace table in Postgres (Langfuse optional) | See §8 cost table. |
| Testing | `vitest@5.0.0`, `msw@2.15.0` (provider mocks + recorded fixtures), `@playwright/test@1.63.0`, `supabase@2.116.0` CLI local stack | |

**Two cost/architecture-changing findings up front**
1. **Vercel Hobby is non-commercial only.** Vercel's fair-use guidelines restrict Hobby to personal, non-commercial use and define "commercial" to include anything built or hosted for financial gain of anyone involved (the agency building it counts); accounts get paused [S: vercel.com/docs/plans/hobby, justinmckelvey.com/blog/is-vercel-free]. Budget **Vercel Pro ($20/seat/month)** before launch. This also unlocks 800 s functions, per-minute crons and Workflow on-demand usage.
2. **Never keep provider URLs.** fal keeps generated media ≥7 days on public URLs; Kie deletes after 14 days and its signed download links live 20 minutes; Kie uploads auto-delete after ≈3 days (sibling reports `fal-api.md` §1.4/§1.6 and `kie-api.md` §2.5). Every job completion handler must stream the output into your own bucket before marking the job `succeeded`.

---

## 1. Reference implementations (fork vs. borrow)

Metadata below was read live via the GitHub search API on 2026-09-05 unless marked otherwise.

| Repo | Stars / forks | Last push | Stack | License | What it covers | Verdict |
|---|---|---|---|---|---|---|
| [fal-ai-community/video-starter-kit](https://github.com/fal-ai-community/video-starter-kit) | 2,389 / 493 | 2025-06-12 (≈15 months stale) | Next.js 14, React 18, Remotion 4.0.249, `@fal-ai/client` 1.2 + `@fal-ai/server-proxy`, IndexedDB (`idb`), zustand, TanStack Query, Radix/shadcn-style components, UploadThing, Biome | MIT | Browser-native multi-track video composer; fal endpoint catalog with `category`, `inputAsset`, `cameraControl`, `imageForFrame` flags (`src/lib/fal.ts`); IndexedDB schema `projects / tracks / keyFrames / media_items` (`src/data/schema.ts`, `db.ts`) | **Borrow**, do not fork: no server DB, no auth, no jobs, no cost tracking; Next 14/React 18. Its `ApiInfo` endpoint descriptor and `MediaItem` shape (`kind: generated|uploaded`, `endpointId`, `requestId`, `status`, `input`, `output`, `url`) are a good seed for our `models` and `media_assets` tables. Also the Remotion `@remotion/player` composition pattern if a timeline editor is ever wanted. |
| [Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) | 27,746 / 4,915 | active (updated 2026-09-05) | Next.js App Router monorepo (`packages/studio`), plain JavaScript, BYOK API key in `localStorage`, all generation via MuAPI (Vadoo); desktop installers | MIT (per description) | "Image / Video / Audio / Lip Sync / Cinema / Workflows / Agents" studio tabs; Workflow Studio node editor (uses Vibe-Workflow); white-label upsell | **UI/IA reference only**: it is a MuAPI front-end with no backend, no persistence, no jobs, no ledger. Useful to screenshot the studio tab structure and prompt forms. |
| [ClabstreamTeam/Open-Higgsfield-AI](https://github.com/ClabstreamTeam/Open-Higgsfield-AI) and ~12 other "Open-Higgsfield-AI" clones (s7674542-cloud, AndyT0073, avabbbb, sunnychase, Autom8AI …) | 127 /, (others 0-1) | 2026-04-19 | `next`, `react`, `axios`, `react-hot-toast`, a private `studio` package; homepage muapi.ai | none declared (README claims MIT) | SEO-farm clones of the same MuAPI front-end | **Skip.** |
| [SamurAIGPT/Vibe-Workflow](https://github.com/SamurAIGPT/Vibe-Workflow) | 573 / 148 | active | `client/` Next.js + shared `workflow-builder` lib, `server/` FastAPI, Docker Compose; MuAPI | (README: open source; license not verified) | Node-based canvas (Weavy / Krea Nodes / Freepik Spaces / Flora alternative) | **Later-phase reference** for a node canvas; the Python backend and MuAPI coupling make it a non-fork. |
| [Comfy-Org/ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend) | 1,999 / 688 | active | Vue 3 + Pinia + PrimeVue (`package.json` [P]) | (not verified) | Official ComfyUI graph UI | Not React; only a UX reference for node graphs. Other ComfyUI fronts found: ComfyBox (690★, Svelte), ComfyScript (702★, Python). |
| [vercel/workflow](https://github.com/vercel/workflow) | 2,375 / 349 | active (Sept 1 2026 release notes [S]) | TypeScript; npm `workflow@4.8.5`, `@workflow/next@4.1.9` (published 2026-08-25 [P]) | see repo LICENSE.md (not fetched) | Durable `"use workflow"` / `"use step"` functions, sleep without compute, hooks, local `npx workflow web` inspector, Postgres self-host "World" | **Use** for multi-step pipelines (see §3). |
| [vercel/mcp-handler](https://github.com/vercel/mcp-handler) | 665 / 88 | active (2.1.1 on 2026-08-13 [P]) | TS; requires `@modelcontextprotocol/server@^2`, `zod@^4`, Node 20+ | Apache-2.0 [P README] | Web-standard MCP handler for Next.js route handlers; `withMcpAuth`, `protectedResourceHandler` (RFC 9728) | **Use** for the MCP route (see §7). |
| [pgr0ss/pgledger](https://github.com/pgr0ss/pgledger) | (stars not fetched) | active (README shows 2025 ULIDs) | Single `pgledger.sql`: functions `pgledger_create_account`, `pgledger_create_transfer(s)`, views `pgledger_accounts_view`, `pgledger_entries_view`, `pgledger_transfers_view`; ULID ids; each entry stores previous/current balance | (not verified) | Double-entry ledger in pure SQL | **Borrow the schema** for the credit ledger (§5). Alternatives seen: `radzserg/lefra` (TS, MIT), `df8org/scaledger`, `ledgerstack-core` [S]. |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | 26,642 / 2,091 | active | Next.js + Supabase + Drizzle + Tailwind (repo topics [P]) | (not verified) | Production-grade Next.js + Supabase + Drizzle monorepo | **Borrow** the Supabase/Drizzle/`@supabase/ssr` wiring patterns. |
| [midday-ai/midday](https://github.com/midday-ai/midday) | 14,952 / 1,859 | active | Next.js + Supabase (+ Trigger.dev background jobs [U]) | (not verified) | Full SaaS with files, background jobs, Supabase Storage | **Borrow** storage/job patterns if choosing Trigger.dev. |
| Vercel template "Fal Video Generator" ([vercel.com/templates/next.js/fal-video-generator](https://vercel.com/templates/next.js/fal-video-generator)) [S] and the AI SDK guide "Generate videos with AI SDK" ([vercel.com/kb/guide/ai-sdk-video-generation](https://vercel.com/kb/guide/ai-sdk-video-generation)) [S] | - | - | AI SDK + `@ai-sdk/fal` | - | Minimal blocking text-to-video demo | Copy the form/skeleton pattern only. |
| [palmier-io/palmier-pro](https://github.com/palmier-io/palmier-pro) | 14,290 / 1,097 | active (created 2026-04) | Swift/macOS "video editor built for AI" with MCP | (not verified) | Shows the market direction (editor + MCP) | Not web; ignore for build, note for product framing. |

Searches for a Next.js + Supabase + fal "studio" repo with >50 stars returned nothing via the GitHub API (queries with `in:description` returned 0 results, so this is weak evidence); the only substantial "studio" projects are the MuAPI-backed ones above. **Conclusion: there is no forkable open-source project that already has the DB/jobs/ledger/MCP backbone you need; build from scratch and borrow UI and schema fragments from video-starter-kit, Open-Generative-AI and pgledger.**

Reference model for the product surface itself remains Higgsfield's MCP (captured live): `generate_image/video(_batch)` with `{model, prompt, aspect_ratio, duration, count 1-4, medias:[{role,value}], params}`, `get_cost:true` preflight, server-side "adjustments", `jobs_wait` long-poll, `media_upload` (presigned PUT) + `media_confirm`, `media_import_url`, `models_explore`, `presets_show`, `show_reference_elements` (`<<<uuid>>>` in prompts), `balance/transactions`. Mirror these as your public API + MCP tool names.

---

## 2. Vercel AI SDK status for media (September 2026)

Facts from the docs in the `vercel/ai` repo (`content/docs/03-ai-sdk-core/*.mdx`, `content/providers/01-ai-sdk-providers/10-fal.mdx`) [P] and npm [P]:

| Capability | API in `ai@7.0.93` | Status | Providers (media-relevant) |
|---|---|---|---|
| Image generation | `generateImage` (no `experimental_` prefix); options `size`, `aspectRatio`, `n`, `maxImagesPerCall`, `seed`, `providerOptions`, `abortSignal`, `headers`; returns `image(s)`, `warnings`, `providerMetadata`, per-call `calls[]` with usage; `wrapImageModel` middleware; `NoImageGeneratedError` | **Stable** | `@ai-sdk/fal@3.0.37` (`fal.image('fal-ai/flux/dev')`, Kontext, Qwen-Image, Recraft, Wan …; `providerMetadata.fal.images[].nsfw/width/height/contentType`), `@ai-sdk/replicate@3.0.37`, OpenAI, Google, BFL, xAI … |
| Speech | `generateSpeech` (stable since 7.0, was `experimental_generateSpeech`) [P][S] | Stable | fal (`fal-ai/minimax/speech-02-hd`, voice-clone, dia-tts, chatterbox), OpenAI, ElevenLabs … |
| Transcription | `transcribe` (stable), `experimental_streamTranscribe` (experimental) | Stable / experimental | fal (`whisper`, `wizper`), OpenAI … |
| Video | `experimental_generateVideo`: `prompt: {text, image}`, `aspectRatio` (incl. `'adaptive'`), `resolution`, `duration`, `fps`, `generateAudio`, `n`, `frameImages` (role-tagged first/last frame), `inputReferences` (reference-to-video; providers route by media type and warn on unsupported kinds), `seed`, `providerOptions`; batching across calls | **Experimental** ("API may change") | fal (`luma-dream-machine/ray-2`, `minimax-video`), Replicate (`minimax/video-01`), Google/Vertex Veo 2/3/3.1, Kling AI (`kling-v2.6-*` incl. motion-control), BFL `flux-3-video`, xAI `grok-imagine-video`; the AI SDK 7 changelog also lists Seedance and Prodia [S] |
| Kie.ai | none | - | No `@ai-sdk/kie` exists; Kie has no official SDK (see `kie-api.md`). |

AI SDK 7.0.0 shipped 2026-06-25 [P npm]; the changelog frames the modality set as text/image/speech/transcription/video with "long-running SSE responses and safer bounded downloads" for video [S: vercel.com/changelog/ai-sdk-7].

**Should you reuse the AI SDK provider abstraction?** Partially:

- It is a *synchronous* abstraction: `generateImage`/`generateVideo` block until bytes come back (`base64`/`Uint8Array`), which for video can be minutes, the doc itself warns to "plan for longer timeouts". On Hobby (300 s hard cap) this is a job killer; on Pro (800 s) it still ties a function to a provider queue. There is no webhook/callback mode and no way to persist a provider `request_id` and resume in another invocation.
- It has no cost preflight, no role-based `medias` mapping, no per-model parameter schema, and Kie is absent.
- What *is* reusable: the shape of `ImageModelV3` / video model specs (`specificationVersion: 'v3'`, `maxImagesPerCall`, `warnings`, `providerMetadata`) as inspiration for your own interface; `@ai-sdk/fal` for cheap synchronous image calls inside a Workflow step; `wrapImageModel` middleware idea for logging.

**Recommendation:** write a thin internal `ProviderAdapter` interface and implement `fal` (on `@fal-ai/client@1.10.1`: `fal.queue.submit({webhookUrl, priority})`, `status`, `result`, `storage.upload`) and `kie` (hand-written fetch client: `POST /api/v1/jobs/createTask {model,input,callBackUrl}`, `GET recordInfo`, `POST /common/download-url`). Suggested surface:

```ts
interface ProviderAdapter {
  id: 'fal' | 'kie';
  listModels(): Promise<CatalogModel[]>;                 // sync into models table
  estimateCost(model, input): Promise<Money | null>;     // fal: from catalog pricing; kie: static table (no preflight endpoint)
  submit(job: NormalizedJob, cb: { webhookUrl }): Promise<{ providerRequestId: string }>;
  status(providerRequestId): Promise<'queued'|'running'|'succeeded'|'failed'>;
  result(providerRequestId): Promise<{ outputs: OutputRef[]; raw: unknown; costActual?: Money }>;
  verifyWebhook(req: Request): Promise<WebhookEvent>;    // fal ED25519/JWKS, kie HMAC-SHA256
  mapMedias(model, medias: {role, value}[]): Record<string, string|string[]>; // role -> *_url fields
}
```

---

## 3. Async job architecture on Vercel + Supabase

### 3.1 Platform limits that shape the design

| Limit | Hobby | Pro | Source |
|---|---|---|---|
| Vercel Function max duration (Fluid compute) | 300 s default & max | 300 s default, 800 s max; Node/Python up to 1,800 s (30 min) in beta | [S: vercel.com/docs/functions/configuring-functions/duration, changelog "vercel-functions-can-now-run-up-to-30-minutes"] |
| Function memory / CPU (Hobby) | 2 GB / 1 vCPU (secondary source) | configurable | [S: verygoodffmpeg.com] |
| Request/response body | 4.5 MB | 4.5 MB | [S], never proxy uploads/downloads through a function body |
| Bundle size | 250 MB uncompressed | same | [S: github.com/orgs/vercel/discussions/103], bundling ffmpeg is impractical |
| Cron jobs | historically 2 per project, **once per day** precision; changelog now says 100 crons/project on every plan (frequency restriction on Hobby appears to remain, unverified) | per-minute | [S: vercel.com/docs/cron-jobs/usage-and-pricing, changelog "cron-jobs-now-support-100-per-project-on-every-plan"] |
| Vercel Workflow (DevKit, **public beta**) | 50,000 workflow events/month, 1 GB data written, 1-day retention after run completion, "Workflow Data Retained" not available | on-demand: $0.02 / 1K events, $0.50 / GB written, $0.50 / GB-month retained | [S: vercel.com/docs/workflows/pricing] |
| Vercel Queues (public beta since 2026-02-27) | available on all plans, $0.60 / 1M operations; `@vercel/queue@0.5.1` | same | [S: vercel.com/changelog/vercel-queues-now-in-public-beta, docs/queues/pricing] |
| Vercel Sandbox (GA 2026-01-30) | 5 active-CPU hours, 5,000 creations included; hard pause after | $0.128 / vCPU-hour, $0.0212 / GB-hour, $0.60 / 1M creations | [S: vercel.com/docs/sandbox/pricing] |
| Supabase pg_cron | every second → yearly; "no more than 8 jobs concurrently, each ≤10 min" | same | [P: cron.mdx] |
| Supabase Queues (pgmq) | `pgmq_public.send / send_batch / read(queue, vt, n) / pop / archive / delete`; optional PostgREST exposure with RLS on `pgmq.q_*`; needs Postgres ≥15.6.1.143 | same | [P: queues.mdx, queues/api.mdx, quickstart.mdx] |
| Supabase Realtime | 200 concurrent connections, 100 msg/s, 256 KB broadcast payload, 2M messages/month | 500 connections (10,000 without spend cap), 500 msg/s, 3,000 KB; 5M msgs; overage $2.50 / 1M msgs, $10 / 1,000 peak connections | [P: realtime/limits.mdx] + [S: pricing] |

Third-party orchestrators (all have first-class Next.js/Vercel integrations):

| Option | Package (npm, 2026-09-05) | Free tier | Paid entry | Notes |
|---|---|---|---|---|
| Inngest | `inngest@4.20.0` (published 2026-09-04) | 50k executions/mo, 5 concurrent, 500 MB spans (one source: 100k / 25 concurrent) | Pro $75/mo (another source $99) | v4 (Mar 2026) added checkpointing + deferred functions; Vercel Marketplace integration sets keys and syncs on deploy [S: inngest.com/pricing, inngest.com/docs/deploy/vercel]. Hobby *pauses* when quota is exhausted. |
| Trigger.dev v4 | `@trigger.dev/sdk@4.5.16` | $5 usage credit, 20 concurrent, 1-day logs | Hobby $10, Pro $50 | No platform time limit (own workers), waitpoints for webhooks/human approval, Apache-2.0 self-host [S: trigger.dev/pricing]. Best fit if you want ffmpeg/long renders without Vercel limits. |
| Upstash Workflow / QStash | `@upstash/workflow@1.3.3`, `@upstash/qstash@2.11.3` | (free tier exists [U]) | usage | Steps are HTTP calls into your app; 3 retries + DLQ [S: upstash.com blog]. |
| Cloudflare Workflows | - | Workers free tier | Workers Paid $5/mo; per-step & storage billing from 2026-08-10 | 10k steps/instance (25k max), 1 MiB state/step, sleep ≤365 d [S: developers.cloudflare.com changelog]. Only worth it if you move compute to Cloudflare. |
| Vercel Workflow DevKit | `workflow@4.8.5` | see table above | on-demand | Self-hostable with Postgres "World"; docs bundled in `node_modules/workflow/docs` [P README]. |

### 3.2 Recommended design (MVP, works on Hobby, scales on Pro)

1. **Postgres is the state machine.** `jobs` row: `queued → submitted → running → copying → succeeded | failed | cancelled`, with `provider_request_id`, `attempt`, `idempotency_key` (unique), `webhook_received_at`, `next_poll_at`, `error`. All transitions via one `transition_job(job_id, from[], to, patch)` SQL function so webhooks, pollers and workflows cannot race.
2. **Submission path** (Server Action or `/api/v1/generations`): validate with zod against the model's param schema → `estimateCost` → **reserve credits** in the ledger (see §5) → insert `jobs` → call `adapter.submit(..., {webhookUrl: https://app/api/webhooks/fal?job=<id>&t=<hmac>})` → store `provider_request_id`. All inside one request, well under 300 s.
3. **Completion path** = provider webhook (primary) + reconciler (safety net):
   - `/api/webhooks/fal`: verify ED25519 signature against `https://rest.alpha.fal.ai/.well-known/jwks.json`, reject |now−ts| > 300 s; `/api/webhooks/kie`: verify `X-Webhook-Signature` = base64(HMAC-SHA256(`taskId.timestamp`, key)). Both providers may deliver multiple times → idempotent on `(provider, request_id)`. Return 200 fast; do the heavy work (copy media to storage, ledger settle) with `waitUntil` from `@vercel/functions@3.9.5` or by enqueueing to pgmq.
   - Reconciler every minute: `pg_cron` → `pg_net` HTTP call to `/api/internal/reconcile` (bearer secret) which polls `status()` for jobs with `next_poll_at < now()`, with exponential backoff and a hard timeout (e.g. 30 min) → `failed` + refund. This sidesteps Hobby's once-a-day cron limit because the schedule lives in Supabase, not Vercel.
4. **Multi-step pipelines** (e.g. *generate image → upscale → image-to-video*, or Higgsfield-style `count: 4` fan-out) run as a Vercel Workflow (`"use workflow"`) whose steps are `submit` + `waitForHook` (the webhook resumes the run), so no compute is held while waiting; Inngest is the drop-in alternative if you prefer a GA product with an inspector UI. Keep each step's side effects idempotent and key them on `job_id`.
5. **`jobs_wait` for MCP/API** (Higgsfield semantics: up to 12 jobs, 15 s): implement as a short server-side loop (≤ 25 s) polling `jobs`, never longer, so it works on Hobby and behind proxies.
6. **Realtime to the browser:** trigger on `jobs` + `media_assets` calling `realtime.broadcast_changes()` into a private topic `ws:<workspace_id>`; client subscribes with `supabase.channel('ws:…', { config: { private: true } })` and invalidates TanStack Query caches. Free-plan limits (200 connections, 100 msg/s) are ample for a team. SSE from Vercel functions is possible but holds compute; polling every 3 s is the fallback for the MCP client.

Why not Supabase Queues as the worker queue? There is no long-running consumer on Vercel to `read()` from pgmq except a cron-triggered function; pgmq is still useful as a durable buffer for *post-processing* tasks (copy, thumbnail, ledger settle) drained by the reconciler function in batches, with the visibility timeout as your retry mechanism.

---

## 4. Media storage

### 4.1 Provider outputs expire: copy at completion time
- fal: generated media on the fal CDN "for at least 7 days by default", public URLs, controllable per request with `X-Fal-Object-Lifecycle-Preference` (`expires_in`: `1h…1y`, `never`); request payloads kept 30 days (sibling `fal-api.md` §1.3/§1.6 [S+V]).
- Kie: generated files deleted after 14 days (MJ page says 15; unified task page says "URLs typically expire after 24 hours"); `POST /api/v1/common/download-url` gives a 20-minute signed link; uploads auto-delete after ≈3 days; result hosts are `tempfile.aiquickdraw.com` / `file.aiquickdraw.com` (sibling `kie-api.md` §2.5 [S+observed]).

### 4.2 Options

| | Supabase Storage | Cloudflare R2 | Vercel Blob | S3 |
|---|---|---|---|---|
| Storage price | 100 GB included on Pro, then ≈$0.021/GB-month [S: pricing pages]; Free 1 GB | $0.015/GB-month; free 10 GB | $0.023/GB-month (regional up to $0.041); Hobby 1 GB | ≈$0.023/GB [U] |
| Egress | Pro: 250 GB uncached + 250 GB cached included; overage $0.09/GB uncached, **$0.03/GB cached** (Smart CDN); Free 5 GB + 5 GB [P: egress.mdx] | **$0** | $0.05/GB; Hobby 10 GB | ≈$0.09/GB [U] |
| Ops | none itemised | Class A $4.50/M, Class B $0.36/M; free 1M A / 10M B | simple $0.40/M, advanced $5/M; Hobby 10k/2k | - |
| Max object | Free **50 MB**, Pro/Team **500 GB** (global limit, per-bucket caps) [P: file-limits.mdx] | 5 TB (multipart) [U] | 5 TB [U] | 5 TB |
| Browser upload | TUS resumable at `https://<ref>.storage.supabase.co/storage/v1/upload/resumable`, **chunk must be 6 MB**, upload URL valid 24 h, `x-upsert`, signed upload tokens via `createSignedUploadUrl` + `x-signature` header; clients: `tus-js-client@4.3.1`, `@uppy/tus@6.0.0` [P: resumable-uploads.mdx] | presigned PUT / multipart | client tokens | presigned |
| Image transforms | `…/render/image/public|sign/...?width=&height=&resize=&quality=&format=`, **Pro plan and above**; signed transformed URLs supported; 100 origin images free then ≈$5 per 1,000 [P: image-transformations.mdx; S: pricing] | Cloudflare Images/Media Transformations: 5,000 unique transforms free then $0.50/1,000; **video frame extraction counts as 1 transformation** [S] | none | none |
| Video thumbnails | none server-side | Media Transformations (frame mode) [S] | none | none |
| S3 API | yes: S3-compatible endpoint with server-only access keys (bypass RLS) or session tokens honoring RLS [P: s3/authentication.mdx] | yes | no | yes |
| Auth integration | RLS on `storage.objects`, signed URLs, Supabase Auth JWT | Worker or presigned | Vercel token | IAM |

### 4.3 Recommendation
- **Default: Supabase Storage**, one private bucket per asset class (`uploads`, `outputs`, `thumbs`), objects keyed `ws/<workspace>/<asset_id>.<ext>`, served through **signed URLs (1 h)** and the image render endpoint for thumbnails/previews (cached egress at $0.03/GB). Requires **Supabase Pro ($25/mo)** for both the 50 MB→500 GB file limit and image transformations, plan it.
- **Copy pipeline:** in the webhook handler stream `fetch(providerUrl)` → `@aws-sdk/client-s3@3.1127.0` multipart upload against the Supabase S3 endpoint (or `storage-js` `upload` for < 50 MB). Server-side fetch→upload is not subject to the 4.5 MB body limit; a 200 MB video copies well inside 300 s. Record `bytes`, `sha256`, `mime`, `width/height/duration` (probe with `mediabunny@1.55.7` or `sharp@0.35.4`).
- **Thumbnails / posters:** (a) images via Supabase render endpoint; (b) video posters generated **in the browser** at upload/first-view time with `mediabunny` (MPL-2.0, WebCodecs, zero deps, also runs in Node via `@mediabunny/server`) and uploaded to `thumbs`; (c) if server-side is required, run `mediabunny` in a Node function (no ffmpeg binary needed) or, for real ffmpeg, Vercel Sandbox (5 CPU-hours free on Hobby) / Trigger.dev workers. Avoid bundling ffmpeg in functions (250 MB limit, cold starts).
- **Escape hatch:** if monthly video egress passes ~250 GB, move `outputs` to R2 (zero egress, same S3 client) and keep Supabase for metadata/RLS; enable Cloudflare Media Transformations there for frame extraction.
- **Uploads from the browser:** Uppy + TUS for anything > 6 MB (resumable, 24 h URL), plain `storage.upload` for small images; mirror Higgsfield's `media_upload` (returns a signed upload token/URL) + `media_confirm` (server probes the object, writes `media_assets`).

---

## 5. Data model

Postgres (Drizzle `drizzle-orm@0.45.2` / `drizzle-kit@0.31.10`, or Supabase migrations + generated types). All tables carry `workspace_id` for RLS even though the MVP is single-tenant.

| Table | Key columns | Notes / reference |
|---|---|---|
| `workspaces`, `workspace_members` | `role` (owner/admin/member) | Higgsfield `list_workspaces/select_workspace`. |
| `profiles` | `id = auth.users.id` | Supabase Auth mirror. |
| `providers` | `id` ('fal','kie'), `status`, `secrets_ref` | |
| `models` | `id` (slug), `provider_id`, `provider_model_id` (e.g. `fal-ai/kling-video/v2.6/pro`, Kie `market/...`), `modality` (image/video/audio/3d), `task` (t2i, i2i, t2v, i2v, ref2v, upscale, bg-remove, reframe, outpaint), `params_schema jsonb` (JSON Schema, synced from fal OpenAPI `/v1/models?expand=openapi-3.0`, see `fal-api.md`), `media_roles jsonb` (role → provider field, min/max, mime), `aspect_ratios text[]`, `durations int[]`, `pricing jsonb` (unit, amount, currency, source, fetched_at), `capabilities jsonb`, `enabled`, `synced_at` | Mirrors Higgsfield `models_explore` output (`params`, `medias[].roles`, `aspect_ratios`, `durations`) and video-starter-kit's `ApiInfo` (`category`, `inputAsset`, `cameraControl`). |
| `model_aliases` | `alias` → `model_id` | lets the API say `kling-2.6-pro` while routing to the cheapest provider. |
| `projects` (folders) | `parent_id`, `name` | video-starter-kit `projects`. |
| `media_assets` | `id`, `workspace_id`, `kind` (uploaded/generated/imported/derived), `bucket`, `path`, `mime`, `bytes`, `sha256`, `width`, `height`, `duration_ms`, `poster_asset_id`, `source_job_id`, `provider_url_expired_at`, `status` (pending/confirmed/failed), `metadata jsonb` | Higgsfield `media_upload/confirm/import_url`; medias are referenced by **asset id or job id, never URL**. |
| `jobs` | `id`, `workspace_id`, `user_id`, `model_id`, `provider_id`, `provider_request_id`, `parent_job_id` (batches/pipelines), `status`, `input jsonb` (normalized: prompt, aspect_ratio, duration, count, medias[{role,asset_id}], params), `provider_input jsonb`, `adjustments jsonb` (clamped params, like Higgsfield), `cost_estimate`, `cost_actual`, `reservation_id`, `attempt`, `idempotency_key unique`, `webhook_received_at`, `next_poll_at`, `started_at`, `finished_at`, `error jsonb` | `show_generations`, `jobs_wait`. |
| `job_outputs` | `job_id`, `index`, `asset_id`, `provider_url`, `seed`, `nsfw` | one row per generated file. |
| `elements` (reference elements) | `id`, `name`, `asset_ids[]`, `description`, `token` (`<<<uuid>>>`) | Higgsfield `show_reference_elements`. |
| `characters` | `id`, `name`, `training_asset_ids[]`, `provider_lora_ref`, `status` | Higgsfield Soul; fal LoRA training later. |
| `presets` | `id`, `modality`, `model_id`, `params jsonb`, `prompt_template`, `preview_asset_id`, `tags[]` | Higgsfield's 62 image-to-video presets. |
| `workflows` / `workflow_runs` | SKILL.md-style instructions + run linkage to jobs | Higgsfield `get_workflow_instructions`. |
| **Ledger** `ledger_accounts` (`workspace.available`, `workspace.reserved`, `provider.<id>.expense`, `system.topups`), `ledger_transfers`, `ledger_entries` (with `account_version`, `previous_balance`, `current_balance`) | as in pgledger [P]; amounts in **micro-EUR** (`bigint`) plus a `credits` view if you want Higgsfield-style credits. |
| `cost_reservations` | `job_id`, `transfer_id` (available→reserved), `amount`, `state` (held/settled/released), `settled_transfer_id` | On success: reserved→expense with actual (fal price × units; Kie `creditsConsumed` × your EUR/credit), difference released back; on failure: reserved→available (refund). Never mutate balances directly, only transfers. |
| `provider_calls` | `job_id`, `provider_id`, `op` (submit/status/result/webhook/copy), `http_status`, `latency_ms`, `request/response jsonb (redacted)`, `error` | your "Langfuse" for media. |
| `api_keys` | `id`, `workspace_id`, `user_id`, `name`, `prefix` (`rfl_…` first 8 chars), `hash` (SHA-256 of secret), `scopes text[]`, `last_used_at`, `expires_at`, `revoked_at` | for MCP/automation clients (§7). |
| `oauth_grants` (view over Supabase's OAuth clients) | | audit which MCP clients users approved. |
| `audit_log` | `actor_id/api_key_id`, `action`, `target`, `diff jsonb`, `ip`, `ua` | append-only; populate from triggers + app. |

Enums to define once and reuse in zod, DB and MCP schemas: `modality`, `task`, `job_status`, `media_role` (`image`, `first_frame`, `last_frame`, `reference`, `video`, `audio`, `mask`, `element`, `character`).

---

## 6. Frontend

Packages (npm `latest` on 2026-09-05 [P]): `next@16.3.4`, `react@19.2.8`, `react-dom@19.2.8`, `tailwindcss@4.3.3`, `shadcn@4.21.0` (CLI; `radix-ui@1.6.7` unified package or `@base-ui-components/react@1.0.0-rc.0`), `@tanstack/react-query@5.102.8`, `zustand@5.0.15`, `nuqs@2.10.1`, `react-hook-form@7.87.0` + `@hookform/resolvers@5.9.1` + `zod@4.5.4`, `react-dropzone@20.1.1`, `@uppy/core@6.0.0` + `@uppy/tus@6.0.0` + `@uppy/react@6.0.0`, `media-chrome@4.19.2` (or `@vidstack/react@0.6.15`), `react-compare-slider@4.0.0`, `react-plock@3.6.1`, `@tanstack/react-virtual@3.14.10`, `react-hotkeys-hook@5.3.3`, `cmdk@1.1.1`, `sonner@2.0.8`, `lucide-react@1.41.0`, `date-fns@4.4.0`, `mediabunny@1.55.7`, `@remotion/player@4.0.520` (only if a timeline editor is added).

Next.js 16 specifics to adopt [S: nextjs.org/blog/next-16, next-16-3-turbopack]:
- Turbopack default; **Cache Components** (`cacheComponents: true`) with `"use cache"` replacing the old `experimental.ppr`; `revalidateTag`/`updateTag`/`refresh()`; `middleware.ts` → **`proxy.ts`** (put the Supabase session refresh from `@supabase/ssr@0.12.6` there). 16.3 (stable 2026-08-03 per npm) adds persistent Turbopack build cache.
- Server Actions for mutations that must be fast (create job, rename, favorite) with `next-safe-action@8.7.1`; Route Handlers for the public REST API (`/api/v1/*`), webhooks and MCP.
- Do not cache the results feed (`jobs`), mark it dynamic and let Realtime + TanStack Query own freshness; cache the `models` catalog and presets with `"use cache"` + tag `models`, revalidated by the sync job.

Higgsfield-like layout (three regions, keep it):
1. **Left rail** (icons + labels): Create (Image / Video / Edit), Assets, Elements & Characters, Presets, Workflows, History, Balance, Settings. Collapsible; `zustand` for UI state.
2. **Prompt dock** (bottom or right-bottom sticky): model picker (cmdk command palette, grouped by provider/task, showing price/unit from `models.pricing`), prompt textarea with `<<<element>>>` chips, media slots rendered from `models.media_roles` (drop targets via `react-dropzone`), aspect ratio / duration / count segmented controls constrained by `models.aspect_ratios/durations`, advanced params auto-generated from `params_schema` (JSON-Schema → react-hook-form), **live cost estimate** (`estimateCost` via TanStack Query, debounced), Generate button, batch toggle (count 1-4).
3. **Results feed** (center): reverse-chronological job groups; skeleton cards while `queued/running` (progress from Realtime), masonry (`react-plock`, or CSS `grid-template-rows: masonry` / grid lanes where supported) virtualised with `@tanstack/react-virtual`; card actions: Reuse prompt, Use as reference (adds to slot), Upscale / Remove BG / Reframe / Outpaint (spawn child job), Compare (react-compare-slider for before/after edits), Download (signed URL), Add to project, Delete. Video cards use `media-chrome` with poster from `thumbs`.
4. **Asset detail drawer**: metadata, provenance (job → inputs → parent), seed, cost, provider request id (copyable), re-run.

---

## 7. Auth

**Web app:** Supabase Auth with email/password + Google; `@supabase/ssr@0.12.6` cookie sessions; RLS on every table keyed by `workspace_members`. Nothing unusual here, copy the wiring from onlook/midday.

**MCP server (Streamable HTTP on Vercel):**
- Transport: `mcp-handler@2.1.1` + `@modelcontextprotocol/server@2.0.0` (MCP SDK v2, published 2026-07-27 [P]) mounted at `app/api/mcp/route.ts` (`GET`+`POST`); stateless, no Redis, serves the **2026-07-28** spec natively and 2025-era Streamable HTTP clients via fallback; HTTP+SSE (2024-11-05) is gone in 2.x [P README]. Add `export const maxDuration = 300` (Hobby cap) and keep `jobs_wait` ≤ 25 s.
- Authorization per the MCP spec [P: 2025-06-18 and 2025-11-25 `authorization.mdx`]: servers **MUST** publish RFC 9728 Protected Resource Metadata and answer 401 with `WWW-Authenticate`; tokens must be audience-bound to the server (RFC 8707 `resource`); PKCE mandatory; the 2025-11-25 revision makes **Client ID Metadata Documents (CIMD) SHOULD** and Dynamic Client Registration **MAY**; mcp-handler says the 2026-07-28 spec deprecates DCR in favour of CIMD, implemented on the *authorization server* side [P: mcp-handler README / docs/AUTHORIZATION.md].
- **Supabase Auth as the OAuth 2.1 authorization server** [P: oauth-server.mdx, mcp-authentication.mdx; S: getting-started]: public beta since 2025-11-26, free on all plans during beta; issuer `https://<ref>.supabase.co/auth/v1`, discovery at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`; authorization-code + PKCE; you build the consent page (authorization endpoint UI) in Next.js; optional dynamic client registration (`allow_dynamic_registration`), the docs warn to require user approval and validate redirect URIs; auth codes expire in 10 min; access tokens are ordinary Supabase JWTs with `user_id`, `role`, **`client_id`** claims, so RLS applies and Custom Access Token Hooks can add `aud`/scopes. CIMD support on Supabase's side is **not documented yet (open question)**: Claude Desktop/Cursor-class clients still work with DCR or pre-registered clients.
- **Recommended dual scheme** inside one `verifyToken`:
  1. Bearer looks like a JWT → verify with `jose@6.2.12` against Supabase JWKS, require `aud`/`client_id`, map to `user_id` + workspace, scopes from token.
  2. Bearer starts with `rfl_` → SHA-256 lookup in `api_keys`, check `revoked_at/expires_at/scopes`, touch `last_used_at`. This is what n8n, scripts, Claude Code's `mcp-remote` and CI need; it also mirrors Higgsfield's own key-based MCP. Note the spec's rule that servers only accept tokens from their configured authorization server, an API key issued by the resource itself is a pragmatic exception you should document.
- `protectedResourceHandler({ authServerUrls: ['https://<ref>.supabase.co/auth/v1'] })` at `/.well-known/oauth-protected-resource` [P: docs/AUTHORIZATION.md]. Alternative if the Supabase beta proves rough: `better-auth@1.7.2` with its OAuth provider/MCP plugin [U].

---

## 8. Operational

### 8.1 Infra cost at small scale (team of 3-5, a few hundred generations/day; excludes generation spend)

| Item | Monthly | Basis |
|---|---|---|
| Vercel Pro | $20 × seats (1 seat if only one deployer) + usage (Fluid compute, Workflow on-demand beyond included) | Hobby is non-commercial [S]. |
| Supabase Pro | $25 (includes $10 compute credit ≈ Micro) + storage > 100 GB at ≈$0.021/GB + egress overage | [S: pricing]; needed for 500 GB uploads, image transforms, 500 Realtime connections. |
| Storage/egress at 200 GB media, 300 GB cached egress | ≈ $2 storage + ≈ $1.5 cached egress | Supabase egress table [P]. R2 alternative ≈ $3 with $0 egress. |
| Orchestrator | $0 (Vercel Workflow Hobby/Pro included events or Inngest free) → $75 if Inngest Pro | |
| Sentry Developer | $0 (1 user, 5k errors/mo) | [S] |
| Axiom Personal | $0 (500 GB/mo ingest, 30-day retention) | [S] |
| Langfuse Hobby (optional) | $0 (50k units/mo, 2 users) | [S] |
| **Total** | **≈ $45-75/month** before generation spend | |

### 8.2 Observability
- `@sentry/nextjs@10.73.0` for errors + traces in route handlers, server actions and the MCP route (tag `job_id`, `provider`, `model`).
- Structured logs (`pino@10.3.1`) shipped to Axiom with `@axiomhq/nextjs@0.4.0`; one log line per `provider_calls` row; dashboards: submit→webhook latency per model, webhook signature failures, reconciler pickups (= missed webhooks), copy failures.
- Generation tracing: the `provider_calls` + `jobs` tables already give a Langfuse-like trace; expose an admin page. If you add LLM prompt-enhancement steps, add Langfuse (`langfuse` SDK) or `@vercel/otel@2.1.3` → Axiom OTLP.
- Alerts: reservation held > 1 h, provider error rate > 10 % in 15 min, balance < threshold, Realtime `too_many_connections`.

### 8.3 Testing strategy
- **Unit** (`vitest@5.0.0`): adapters' `mapMedias`, cost estimation, ledger functions (run against a local Supabase via `supabase@2.116.0` CLI or `pglite` [U]), state-machine transitions, webhook signature verification (fixtures: fal ED25519 test vectors generated with your own keypair; Kie HMAC).
- **Provider contract tests**: `msw@2.15.0` handlers replaying **recorded fixtures** of real fal queue responses (`IN_QUEUE/IN_PROGRESS/COMPLETED`, webhook payloads incl. `payload_error`) and Kie (`createTask`, `recordInfo` with `resultJson` string, callbacks with `successFlag`/`state`), taken from the sibling reports' captured shapes; a nightly "live smoke" job against the cheapest model of each provider with a `€0.05` budget guard.
- **E2E** (`@playwright/test@1.63.0`): login (Supabase test user), upload via TUS, submit image job, receive Realtime update (mock webhook by POSTing a signed payload to the local route), download signed URL; MCP: run `mcp-remote`/SDK client against the dev server and exercise `models_explore → generate_image → jobs_wait`.
- **Migrations**: Supabase branching (Pro) or local `supabase db reset` in CI; generate types with `supabase gen types`.

---

## 9. Shortlist of repos to borrow from

1. **fal-ai-community/video-starter-kit**: endpoint descriptor (`src/lib/fal.ts`), `MediaItem`/project/track schema, fal proxy route, Radix/zustand/TanStack patterns, Remotion player.
2. **pgr0ss/pgledger**: SQL ledger functions/views; adapt to reservations.
3. **vercel/mcp-handler**: `createMcpHandler`, `withMcpAuth`, `protectedResourceHandler`; docs/CLIENTS.md for Claude/Cursor config.
4. **vercel/workflow**: `"use workflow"` examples and Next integration (`withWorkflow` in `next.config.ts`).
5. **Anil-matcha/Open-Generative-AI**: studio IA and prompt forms (UI only).
6. **SamurAIGPT/Vibe-Workflow**: node-canvas UX for a later phase.
7. **onlook-dev/onlook**, **midday-ai/midday**: production Next.js + Supabase (+ Drizzle / Trigger.dev) project structure.
8. **supabase/supabase `apps/docs/content/guides/{queues,cron,realtime,storage,auth/oauth-server}`**: the primary docs, readable via raw.githubusercontent.com when supabase.com is blocked.
9. **vercel/ai `content/docs/03-ai-sdk-core/{35-image-generation,37-speech,38-video-generation}.mdx`, `content/providers/01-ai-sdk-providers/10-fal.mdx`**: for the model interface shapes and fal model ids.

---

## 10. Open questions (as of 2026-09-05)

1. Move to Vercel Pro now (commercial-use clause) or host the Next.js app elsewhere (e.g. Cloudflare/Node) and keep Vercel for previews only?
2. Supabase Pro from day one (needed for >50 MB uploads, image transforms, OAuth server stays free in beta), yes/no?
3. Orchestrator choice for pipelines: Vercel Workflow (beta, first-party, cheap) vs Inngest (GA, richer UI) vs Trigger.dev (long ffmpeg jobs). MVP can defer.
4. Does Supabase's OAuth server support CIMD yet, and which MCP clients the team uses (Claude Desktop, Claude Code, Cursor, n8n), determines whether OAuth or API keys ship first.
5. Currency/unit for the ledger: EUR micro-units with a `credits` display, or Higgsfield-style credits as the primary unit?
6. Whether to store outputs in Supabase Storage only, or R2 from the start for video (egress-driven).
7. Kie cost accounting: no preflight endpoint (see `kie-api.md`), maintain a static price table per model and reconcile with `creditsConsumed` post hoc?

### Sources used (fetched or searched on 2026-09-05)
GitHub API via MCP: fal-ai-community/video-starter-kit, Anil-matcha/Open-Generative-AI, SamurAIGPT/Vibe-Workflow, ClabstreamTeam/Open-Higgsfield-AI, Comfy-Org/ComfyUI_frontend, vercel/workflow, vercel/mcp-handler, onlook-dev/onlook, midday-ai/midday · raw.githubusercontent.com: video-starter-kit `README.md`, `package.json`, `src/lib/fal.ts`, `src/data/schema.ts`, `src/data/db.ts`; vercel/ai `content/docs/03-ai-sdk-core/35-image-generation.mdx`, `36-transcription.mdx`, `37-speech.mdx`, `38-video-generation.mdx`, `content/providers/01-ai-sdk-providers/10-fal.mdx`, `packages/ai/package.json`, `packages/fal/package.json`; supabase/supabase `apps/docs/content/guides/queues.mdx`, `queues/api.mdx`, `queues/quickstart.mdx`, `cron.mdx`, `storage/uploads/file-limits.mdx`, `storage/uploads/resumable-uploads.mdx`, `storage/serving/image-transformations.mdx`, `storage/s3/authentication.mdx`, `platform/manage-your-usage/egress.mdx`, `realtime/limits.mdx`, `realtime/pricing.mdx`, `auth/oauth-server.mdx`, `auth/oauth-server/mcp-authentication.mdx`; modelcontextprotocol/modelcontextprotocol `docs/specification/2025-06-18/basic/authorization.mdx`, `2025-11-25/basic/authorization.mdx`; vercel/workflow `packages/workflow/README.md`; vercel/mcp-handler `README.md`, `docs/AUTHORIZATION.md`; pgr0ss/pgledger `README.md`; Vanilagy/mediabunny `README.md` · registry.npmjs.org for every version quoted · Search snippets (blocked hosts): vercel.com/docs/functions/configuring-functions/duration, vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes, vercel.com/docs/plans/hobby, vercel.com/docs/workflows/pricing, vercel.com/changelog/vercel-queues-now-in-public-beta, vercel.com/docs/sandbox/pricing, vercel.com/docs/cron-jobs/usage-and-pricing, vercel.com/changelog/ai-sdk-7, vercel.com/templates/next.js/fal-video-generator, nextjs.org/blog/next-16, nextjs.org/blog/next-16-3-turbopack, ui.shadcn.com/docs/changelog/2026-03-cli-v4, supabase.com/docs/guides/auth/oauth-server/getting-started, supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing, supabase.com/docs/guides/realtime/broadcast, inngest.com/pricing, trigger.dev/pricing, upstash.com/blog/durable-workflow-engines-compared-every-major-option-in-2026, developers.cloudflare.com/changelog/post/2026-07-07-workflows-billing-updates, egresscost.com/cloudflare, sentry/axiom/langfuse pricing pages, github.com/vidstack/player/discussions/1747 · Sibling reports in this directory: `fal-api.md`, `kie-api.md`.
