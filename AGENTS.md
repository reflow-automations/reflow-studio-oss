# Reflow Studio: brief for contributors and coding agents

Self-hosted AI image and video studio with a REST API and an MCP server. pnpm monorepo:

| Path | What |
|---|---|
| `packages/core` | `@reflow/core`: provider-agnostic model catalog (data), provider adapters (fal.ai, Kie.ai, Higgsfield API, mock), request normalisation, cost estimation, router. Pure TypeScript, Vitest. |
| `apps/web` | Next.js 16 App Router app: studio UI, REST API (`/api/v1/*`), provider webhooks, reconciler, MCP server (`/api/mcp`), `/setup` page. Supabase for auth, Postgres and (fallback) storage. Read `apps/web/AGENTS.md` before touching Next.js code. |
| `supabase/migrations` | Numbered SQL migrations. Production builds apply them (`apps/web/scripts/migrate.mjs`). |
| `scripts/` | Leak gate (`check-public.mjs`) and public export (`export-public.mjs`). |
| `docs/` | Setup guide, architecture, decisions, MCP reference, research. |

`docs/private/` holds owner-local notes. It is not published and may not exist in your checkout; never link to it or copy from it.

## Commands

- `corepack enable`, `pnpm install`, `pnpm dev` (web on http://localhost:3000), `pnpm check` (typecheck, test and lint for every package).
- Core: `pnpm --filter @reflow/core test|typecheck|lint`. `pnpm --filter @reflow/core catalog:verify plan` lists request bodies offline; `catalog:verify` and `catalog:prices` compare against fal.ai and need `FAL_KEY`.
- Web: `pnpm --filter web typecheck` (runs `next typegen` first), `pnpm --filter web lint`, `pnpm --filter web test`, `pnpm --filter web build` (migrates only when a database URL is set, then `next build`).
- Leak gate: `pnpm check:public` must report no hits before anything is published.

## Conventions

- Next.js 16: `proxy.ts` (not middleware); `params`, `searchParams` and `cookies()` are Promises; `RouteContext<"/api/...">` generated types; `revalidateTag(tag, "max")`. Read `apps/web/node_modules/next/dist/docs` when unsure.
- Server-only modules import `"server-only"`. The service-role Supabase client (`supabaseAdmin()`) never reaches the browser.
- Provider request and response mappings are **data** in `packages/core/src/catalog/models/*.ts` (`InputMappingSpec` / `OutputMappingSpec`). Do not add per-model code paths. New bindings start with `verified: false`.
- Provider ids come from core (`PROVIDER_IDS`, `PROVIDER_INFO`). Adding a provider means an adapter, an entry in both, and a migration that extends the `provider_id` enum. See `CONTRIBUTING.md`.
- Every generate call goes through `normalizeRequest` (adjustments), then `ProviderRouter`, then `StudioService.createGeneration`. Completion arrives through signed webhooks (`/api/webhooks/{provider}`) with poll-on-read and `/api/internal/reconcile` as safety nets. Outputs are always copied into the configured storage.
- A submit whose outcome is unknown (timeout, ambiguous 5xx) is never resent to another provider: use `isSafeToFallBack` from core.
- Higgsfield-compatible tool names stay on the API and MCP surface (`models_explore`, `generate_image`, `jobs_wait`, `media_import_url`, ...).
- Storage goes through `StorageBackend` (`apps/web/src/lib/storage`): Cloudflare R2 when all `R2_*` variables are set, Supabase Storage otherwise. `media_assets.bucket` records where an object lives. Never call `db.storage` from the service directly.
- Secrets: `REFLOW_SECRET` (32+ characters) is the single deploy secret; the webhook, reconcile and key-encryption secrets are derived from it (`apps/web/src/lib/secrets.ts`). Legacy `WEBHOOK_SECRET`, `RECONCILE_SECRET` and `KEY_ENCRYPTION_SECRET` win when set. Provider keys entered in the app are AES-GCM ciphertext in `provider_keys` (service role only).
- Access: `OWNER_EMAILS` gates sessions (`proxy.ts`, `currentUser()`, `resolvePrincipal()`) and API keys; production fails closed when it is unset. Since migration 0007 the database also refuses sign-ups for addresses that are not on the allowlist.
- Migrations: never edit a migration that has shipped. Add the next number, keep it idempotent, redefine `public.studio_schema_version()` and bump `REQUIRED_SCHEMA_VERSION` in `apps/web/src/lib/setup/schema.ts`. New functions revoke `EXECUTE` from `public`, `anon` and `authenticated`.
- Never commit `.env*` files (only `apps/web/.env.example`). Use placeholders such as `you@example.com` and `<project-ref>` in docs and tests.
- Deployment: agents do not change hosting settings, environment variables or secrets of anyone's deployment. Hand SQL or settings changes to the owner of that deployment.

## Writing

- Docs and comments are in English. No em dashes or en dashes; use commas, colons or parentheses.
- User-visible changes get a line under `[Unreleased]` in `CHANGELOG.md`, plus a "Needs action when updating" entry when a self-hoster must set a variable, run a migration or change a setting.

## Gotchas

- `Database` row types in `apps/web/src/lib/db/types.ts` must be `type` aliases (interfaces break supabase-js generics).
- Kie: the body `code` is the status; `resultJson` is a JSON string; result URLs expire quickly; rate limit 20 task creations per 10 s (core throttles per API key, per process).
- fal: nested endpoint status URLs use the root app id; webhook signature is ED25519 over `id\nuser\nts\nsha256(body)` with JWKS from rest.alpha.fal.ai / rest.fal.ai.
- Higgsfield: cost estimates do not settle to a billed amount (`estimateSettles: false`); the Higgsfield dashboard is the source of truth for charges.
- Mock provider (`ENABLE_MOCK_PROVIDER=true`): zero cost, SVG placeholder outputs, a prompt containing `[fail]` makes the job fail. It is a last-resort binding, so configured paid keys always win.
