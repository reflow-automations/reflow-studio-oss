# Architecture

Reflow Studio replaces Higgsfield with three surfaces on one codebase: a **studio web UI**, a **REST API** and a **remote MCP server**. All three call the same `StudioService`, which orchestrates the provider-agnostic core.

```
┌───────────────┐   ┌───────────────┐   ┌──────────────────────┐
│  Studio UI    │   │  REST /api/v1 │   │  MCP /api/mcp        │
│  (Next.js)    │   │  (route.ts)   │   │  (mcp-handler v2)    │
└──────┬────────┘   └──────┬────────┘   └──────────┬───────────┘
       │ session cookie    │ session | API key      │ API key (rfl_…)
       └──────────┬────────┴────────────────────────┘
                  ▼
        ┌─────────────────────┐        ┌──────────────────────────┐
        │   StudioService     │──────▶ │ @reflow/core             │
        │ normalise → route   │        │ ModelRegistry (catalog)  │
        │ reserve → submit    │        │ normalizeRequest         │
        │ webhook/poll → copy │        │ ProviderRouter           │
        │ settle ledger       │        │ FalProvider · KieProvider│
        └───┬─────────┬───────┘        │ estimateCost             │
            │         │                └──────────────────────────┘
            ▼         ▼
   Supabase Postgres  Cloudflare R2           fal.ai queue · Kie.ai jobs/veo
   (generations, …)   (or Supabase Storage)   (webhooks + polling)
```

## Personal-deployment layer (`apps/web/src/lib/{storage,settings,auth}`)

- **Storage**: `StorageBackend` (put / readUrl / createUploadTarget / stat / delete). `R2StorageBackend` signs S3 requests with `aws4fetch` (region `auto`, explicit `Content-Length`, presigned PUT/GET via query signatures, `PutBucketCors`); `SupabaseStorageBackend` wraps the private `media`/`uploads` buckets. `getStorageBackends()` returns the primary (R2 when configured) plus the Supabase fallback for older rows; `media_assets.bucket` selects the backend on read. Keys: `<workspace>/<yyyy>/<mm>/<asset-id>.<ext>`.
- **Provider keys**: `provider_keys` holds AES-256-GCM ciphertext (`KEY_ENCRYPTION_SECRET`, AAD `<workspace>:<provider>`), a hint, and the last test result; `provider_key_events` is the audit trail. `routerFor(workspaceId)` (`lib/studio/providers.ts`) resolves secrets (app → env), applies the workspace's routing preference (`workspaces.settings.provider_preference`: cheapest | fal | kie) and caches the `ProviderRouter` for 60 s. `StudioService` receives this resolver instead of a fixed router and asks for it per workspace (`routerFor(null)` = env-only router for webhook parsing before the generation is known).
- **Owner allowlist**: `lib/auth/owner.ts` is pure (usable in `proxy.ts`): `checkOwner(email)` allows listed e-mails, keeps development open when the list is empty and fails closed in production. Enforced in `proxy.ts`, `currentUser()`, `resolvePrincipal()` and `verifyApiKey()`.
- **Status**: `studioStatus(workspaceId)` backs `GET /api/v1/status`, the MCP `studio_status` tool and the Settings → Providers page (key hints/status, preference, storage backend, encryption configured, month-to-date spend vs cap).

## Core (`packages/core`)

**Catalog.** `ModelDefinition` mirrors Higgsfield's `models_explore` shape (id, vendor, output_type, capabilities, parameters[], medias[].role, aspect_ratios, durations, tags) and adds `bindings[]`: one per provider, each with a *declarative* input mapping (`InputMappingSpec`: prompt/aspect-ratio/duration/count fields, role → provider field, parameter renames and value maps, constants) and output mapping (`OutputMappingSpec`: paths such as `images[].url`, `video.url`, `resultUrls[]`). Because mappings are data, the catalog can be audited against provider OpenAPI documents without running code, and adding a model is a data change.

**Normalisation.** `normalizeRequest(model, request)` validates and coerces a Higgsfield-style request (`{model, prompt, aspect_ratio, duration, count, medias:[{role,value}], params}`) and reports non-fatal fixes as `adjustments` (nearest aspect ratio, clamped duration, defaulted params, role coercion) exactly like Higgsfield's MCP does.

**Providers.** `ProviderAdapter` is deliberately small: `submit`, `getStatus`, `cancel`, `parseWebhook`, `upload`, `getBalance`.

- `FalProvider` speaks the queue contract directly (`POST queue.fal.run/{endpoint}?fal_webhook=…`, `GET status_url`, `GET response_url`, `PUT cancel_url`; `Authorization: Key`). Webhooks are verified with ED25519 against fal's JWKS (`request_id\nuser_id\ntimestamp\nsha256(body)`), timestamps within 300 s. Uploads use `rest.fal.ai/storage/upload/initiate` + PUT. Platform APIs (`/v1/models`, `/v1/models/pricing`) back catalog verification and price sync.
- `KieProvider` handles two envelope families: unified jobs (`POST /api/v1/jobs/createTask`, `GET /api/v1/jobs/recordInfo`, `resultJson` is a JSON *string*) and Veo (`/api/v1/veo/generate`, `record-info`, `successFlag`). Webhooks verify `X-Webhook-Signature = base64(HMAC-SHA256(taskId.timestamp, secret))` when a secret is configured; the body `code` is the real status. Kie bills in credits at $0.005.
- `MockProvider` returns placeholder media for local development and tests.

**Router.** `ProviderRouter` keeps only configured providers and orders bindings by strategy (`preferred` order, `cheapest` by static unit price, `quality` by binding priority). `StudioService` tries candidates in order and falls back on infrastructure errors, not on input errors.

**Cost.** `estimateCost` computes a preflight estimate from the binding's `pricing` (per image / megapixel / second / generation / 1k chars, with parameter-based modifiers such as resolution or audio). Kie has no cost preflight API, so estimates come from the catalog and are reconciled with `creditsConsumed` after completion.

## Job pipeline (`apps/web/src/lib/studio/service.ts`)

1. **Create**: normalise → route → estimate → insert `generations` (state `pending`) → ledger `reservation` → submit with webhook URL `…/api/webhooks/{provider}?g=<id>&t=<hmac>` → state `queued`, store `provider_ref` (status/response/cancel URLs) and `provider_input`.
2. **Complete**: the webhook route reads the raw body, responds 200 immediately and processes in `after()`: parse + verify signature (or the `t` token), map the payload through the binding's output mapping, copy each output into the `media` bucket (`media_assets` + `generation_outputs`), then `finalize` (state, cost, ledger `release` + `settlement`).
3. **Reconcile**: any read of a non-terminal generation (UI, API, MCP `jobs_wait`) refreshes it from the provider (rate-limited); `POST /api/internal/reconcile` polls everything overdue and times out jobs after 45 minutes. In production a `pg_cron` job calls it every minute.
4. **Idempotency**: `(provider, provider_job_id)` and `(workspace, idempotency_key)` are unique; every webhook/poll is logged in `provider_events`.

Provider URLs expire (fal ≥ 7 days, Kie 14 days / 20-minute signed links), so outputs are always copied at completion time; the provider URL is kept as a fallback if the copy fails.

## Data model (`supabase/migrations/0001_init.sql`)

`workspaces` / `workspace_members` / `profiles` (auto-provisioned by trigger), `generations` (+ `generation_outputs`), `media_assets`, `folders`, `elements` (reusable references, Higgsfield "elements"), `api_keys` (SHA-256 hashed), `ledger_entries` (+ `ledger_balances` view), `provider_events`. RLS lets workspace members read; writes go through the service-role client on the server. Realtime broadcasts generation changes on `workspace:<id>` (private channel).

## MCP server (`apps/web/src/lib/mcp/server.ts`)

Built on `mcp-handler` 2 + `@modelcontextprotocol/server` 2 (MCP spec 2026-07-28, stateless Streamable HTTP with fallback for 2025-era clients). Tools mirror Higgsfield's: `models_explore`, `generate_image`, `generate_video` (both with `get_cost`), `jobs_wait` (≤ 20 s long-poll), `get_generation`, `show_generations`, `cancel_generation`, `media_import_url`, `media_upload` + `media_confirm`, `show_medias`, `balance`. Auth: `withMcpAuth` verifying `rfl_` API keys; `/.well-known/oauth-protected-resource` is in place for the OAuth 2.1 (Supabase OAuth server) phase.

## Security notes

- Secrets only on the server (`server-only` modules, service-role client never shipped to the browser).
- Webhooks: provider signatures **or** the per-generation HMAC token; unverified events are logged and ignored.
- URL imports reject private-network hosts (SSRF guard); provider fetches use the server's fetch.
- API keys are hashed; scopes `generate`/`read`; revocable; last-used tracking.
- Budget guard: `MONTHLY_BUDGET_USD` (planned enforcement in `createGeneration`), estimates reserved before submission.

## Why not Higgsfield's other surfaces (yet)

Higgsfield's proprietary models (Soul, Cinema Studio, Marketing Studio, presets/DoP, Genjutsu) are product layers over third-party models that fal/Kie also host. The research dossier (`docs/research/`) maps each to an approximation: reference-image elements + optional LoRA training for Soul, prompt systems for Cinema Studio, prompt-chain workflows for Marketing Studio and the 16 SKILL.md workflows, Kling motion control / Wan animate for Genjutsu. These are roadmap items, not MVP.
