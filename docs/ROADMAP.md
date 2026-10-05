# Roadmap

## Phase 0: Research (done)

Review of Higgsfield's public product and MCP tool vocabulary, deep-dives into the fal.ai and Kie.ai APIs with independent fact-checks, provider mapping and stack evaluation. See `docs/research/`.

## Phase 1: MVP (this repository)

- [x] `@reflow/core`: catalog schema, declarative provider bindings, fal + Kie adapters (signed webhooks), normalisation with adjustments, cost estimation, router with fallback, mock provider, unit tests.
- [x] Supabase schema: workspaces, generations, outputs, media assets, elements, API keys, ledger, provider events, RLS, buckets, realtime.
- [x] Web API: models, generations (create/list/get/cancel/wait), estimate, media (upload/confirm/import/list), balance, webhooks, reconcile.
- [x] MCP server (mcp-handler 2 / spec 2026-07-28) with Higgsfield-style tools and API-key auth.
- [x] Studio UI: login, create image/video with model picker + media slots + live cost, results feed, library, assets, models, usage, API keys.
- [ ] First live run against fal.ai and Kie.ai with real keys; fix any schema mismatches (bindings marked `verified: false`).
- [x] `catalog:verify` script: diffs bindings against fal OpenAPI (`/v1/models?expand=openapi-3.0`), with an offline `plan` mode; `catalog:prices` syncs prices from `/v1/models/pricing` (needs `FAL_KEY`).
- [x] Budget guard (`MONTHLY_BUDGET_USD`) enforced before submission (`StudioService.assertBudget`).

## Phase 1b: Self-hosting setup (done)

- Cloudflare R2 storage backend (aws4fetch, presigned uploads, CORS setter) with Supabase Storage fallback.
- Provider keys entered in the app (AES-256-GCM, tested on save), routing preference per workspace, `studio_status` / `set_provider_preference` MCP tools, `GET /api/v1/status`.
- Owner-only access (`OWNER_EMAILS`), enforced for sessions, pages and API keys.
- Catalog request shapes cross-checked against a production Kie/fal integration; Kie settles at the actual `creditsConsumed`.
- Asset memory: prompt/model on every generated asset, searchable via `show_medias(q, model)` and `GET /api/v1/media?q=`.
- Mock provider for demos (`ENABLE_MOCK_PROVIDER`), build-time migrations, `/setup` page with a first-owner flow, single `REFLOW_SECRET`, database-level sign-up allowlist.
- Still open: thumbnails, media retention/purge, storage `list()` plus a migration script for pre-R2 objects, batch generate tools, per-parameter endpoint tiers (Kling std/4k on fal), share links UI (the `shares` table exists since migration 0008).

## Phase 2: Parity features

- Reference **elements** in prompts (`<<<uuid>>>` placeholders → injected reference images), element library UI.
- **Characters** (Soul-like): LoRA training on fal (`flux-2-trainer` / `qwen-image` trainer) + inference bindings; reference-based fallback.
- **Presets**: prompt templates over Kling 3.0 / Seedance image-to-video with preview thumbnails (port the 62 Higgsfield presets as templates).
- **Utilities in UI**: upscale, background removal, outpaint, reframe as one-click actions on any result (bindings already in the catalog).
- **Batch** generation (`count` fan-out as separate jobs, batch view) and pipelines (generate → upscale → animate) via Vercel Workflow or Inngest.
- **Audio**: TTS (ElevenLabs/MiniMax/Seed), voice clone, lipsync (sync-lipsync v3), music/SFX.
- **Realtime UI** via Supabase broadcast instead of polling.
- **OAuth 2.1** for the MCP server (Supabase OAuth server) so Claude.ai connectors work without pasting keys; optional MCP Apps widget for results.

## Phase 3: Product layers

- Workflow library (SKILL.md-style instructions served as MCP resources/prompts): UGC ads, product photoshoot, thumbnails, faceless video, character sheets.
- Marketing-studio style chains (product cutout → hero shots → avatar + TTS + lipsync → assembly in a sandbox with ffmpeg).
- Video analysis / virality rubric with Gemini; clips from long video (transcript → highlights → crop → subtitles).
- 3D generation (Meshy/Tripo/Hunyuan via fal).
- Multi-tenant workspaces + Stripe billing if the studio is offered to clients.
