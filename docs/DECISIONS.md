# Architecture decision records

## ADR-001: Stack: Next.js 16 + Supabase + Vercel, TypeScript monorepo
Chosen because all three have usable free tiers, a one-click deploy path (Vercel plus the Supabase integration) and first-class TypeScript support. Core logic lives in `packages/core` so it can be reused by a local stdio MCP or a worker later. Vercel **Pro** is required for commercial use (Hobby is non-commercial and limits crons to daily, which is why the reconciler runs in Postgres with pg_cron).

## ADR-002: fal.ai primary, Kie.ai secondary behind a router
fal covers ~85% of Higgsfield's catalog with one queue contract, signed webhooks, catalog/pricing/OpenAPI APIs and official SDKs; Higgsfield itself resells fal endpoints. Kie is 1.5-3× cheaper on several closed models (Seedance 2.5, Veo 3.1 fast, Kling 3.0, GPT Image 2) but is an unofficial reseller with mixed schemas, opt-in webhook signatures, 20 creates/10 s rate limit and no cost preflight. The `ProviderRouter` prefers fal, can be switched to `cheapest`, and falls back on infrastructure errors. Direct vendor APIs are added only for gaps (ElevenLabs voice management, Gemini analysis).

## ADR-003: Data-driven catalog with declarative bindings
Model definitions mirror Higgsfield's `models_explore` shape so the UI/API/MCP are self-describing; each provider binding declares input/output field mappings as data. Benefits: auditable against provider OpenAPI (`catalog:verify`), no per-model code, easy price sync. Trade-off: exotic models need mapping-spec features (added as needed).

## ADR-004: Webhook-first completion, poll-on-read, Postgres as the state machine
Generation state lives in `generations`; providers call signed webhooks; any read of a running job refreshes it (rate-limited); `pg_cron` → `/api/internal/reconcile` is the safety net. No orchestrator dependency for the MVP; Vercel Workflow/Inngest are reserved for multi-step pipelines.

## ADR-005: Copy every output into our storage
fal keeps outputs ≥ 7 days on public URLs, Kie 14 days with 20-minute signed links and 3-day uploads. Outputs are streamed into the private `media` bucket at completion and served with signed URLs; the provider URL is kept only as a fallback.

## ADR-006: API keys now, OAuth 2.1 later for MCP
Hashed `rfl_` keys authenticate the REST API and the MCP server (`withMcpAuth`), which is what Claude Code, Cursor, n8n and scripts need today. Claude.ai custom connectors prefer OAuth; the protected-resource metadata endpoint is already in place and Supabase's OAuth server is the planned authorization server.

## ADR-007: Cost ledger in USD, reservation → settlement/release
All spend is recorded as append-only ledger entries; a reservation equal to the estimate is placed before submission and settled or released on completion. Kie credits are converted at $0.005 and reconciled with `creditsConsumed`. A monthly USD budget cap (`MONTHLY_BUDGET_USD`) blocks submissions when exceeded.

## ADR-008: Keep Higgsfield's tool vocabulary
Tool and field names (`models_explore`, `generate_image`, `medias[{role,value}]`, `jobs_wait`, `media_import_url`, `adjustments`, `get_cost`) are preserved so existing prompts, skills and workflows written against Higgsfield's MCP port over with minimal change. The product itself is not called Higgsfield (trademark).

## ADR-009: Cloudflare R2 as the primary object store (Supabase Storage as fallback)

R2 has 10 GB of free storage and no egress fees, which matters for video. The backend uses `aws4fetch` with keys `<workspace>/<yyyy>/<mm>/<asset-id>.<ext>`. `StorageBackend` (`apps/web/src/lib/storage`) abstracts put / read URL / presigned upload / stat / delete; `R2StorageBackend` is chosen when the four `R2_*` variables are set, `SupabaseStorageBackend` otherwise. `media_assets.bucket` records where each object lives so reads keep working after a switch. R2 read URLs are public when `R2_PUBLIC_URL` is set, presigned (6 h) otherwise, the bucket can stay private and providers still fetch reference media. Browser uploads PUT straight to a presigned URL, so the bucket needs CORS (Settings → Providers → Apply CORS).

## ADR-010: Provider keys live in the app, encrypted; environment variables remain a fallback

Keys are entered in Settings → Providers and stored in `provider_keys` as AES-256-GCM ciphertext under a key derived from `REFLOW_SECRET` (or the legacy `KEY_ENCRYPTION_SECRET`) with AAD `<workspace>:<provider>`, tested on save, and never sent to the browser (RLS with no policies; service role only). `routerFor(workspaceId)` decrypts them (falling back to `FAL_KEY` / `KIE_API_KEY` / `HIGGSFIELD_API_CREDENTIAL`), applies the workspace's routing preference (`cheapest` | `fal` | `kie` | `higgsfield`) and caches the router for 60 s; saving a key or the preference invalidates the cache. The REST API and the MCP server go through the same `StudioService`, so MCP clients inherit the keys without ever seeing them, an MCP tool that accepts secrets was deliberately not added. Default tie-break order is Kie first, then fal, then Higgsfield (`DEFAULT_PROVIDER_PREFERENCE` in core); a key whose last test failed is skipped so routing falls through to the other provider.

## ADR-011: Owner-only access by e-mail allowlist

The studio is a personal deployment. `OWNER_EMAILS` is enforced in four places: `proxy.ts` (page navigation, using the JWT claims), `currentUser()` (server components and actions), `resolvePrincipal()` (REST session auth, 403) and `verifyApiKey()` (a key stops working when its owner leaves the list). With an empty list development stays open but production fails closed, so a forgotten variable cannot expose the deployment. Since migration 0007 the database enforces the same list: a trigger on `auth.users` refuses every new account whose e-mail is not in `private.allowed_emails`, which the build-time migration syncs from `OWNER_EMAILS`. Direct sign-ups through the public Supabase anon key therefore fail too. The login page hides "Create account" unless `ALLOW_SIGNUP=true`.
