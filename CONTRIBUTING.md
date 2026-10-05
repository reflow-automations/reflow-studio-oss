# Contributing to Reflow Studio

Thanks for helping out. Reflow Studio is a self-hosted AI image and video studio: a Next.js app, a REST API and a remote MCP server on top of fal.ai, Kie.ai and the Higgsfield API. Every member runs their own instance with their own provider keys, so most contributions are one of three things: a new model binding (data only), a bug fix, or a feature that works for every self-hoster.

Issues and discussions may be in English or Dutch. Code, comments, docs and commit messages are in English.

## Ground rules

- **Never commit secrets.** No `.env*` files (only `apps/web/.env.example`, with empty values), no provider keys, no `rfl_` API keys, no Supabase keys, not even in tests or screenshots. Tests use obviously fake values. If you leaked a key, revoke it at the provider first, then tell us (see [SECURITY.md](SECURITY.md)).
- **Data, not code paths, for models.** Provider request and response mappings are data in `packages/core/src/catalog/models/*.ts`. Do not add `if (model === ...)` branches to adapters or the app.
- **Server-only stays server-only.** Modules that touch secrets or the service-role Supabase client import `"server-only"`. Never put a secret behind a `NEXT_PUBLIC_` prefix.
- **One topic per pull request.** Small PRs get reviewed quickly; a PR that mixes a refactor with a feature waits.
- Be kind and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Node.js 22 (see `.nvmrc`), pnpm 10 (via Corepack) and a Supabase project: a free cloud project, or a local one with the Supabase CLI (`supabase start`).

```bash
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

Fill in `apps/web/.env.local`:

1. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from your Supabase project.
2. `REFLOW_SECRET`: one random string of at least 32 characters. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. The app derives its webhook, reconcile and key-encryption secrets from it.
3. `OWNER_EMAILS` with the email you will log in with.

Apply every file in `supabase/migrations/` in numeric order (Supabase SQL Editor, or `supabase db push` with the CLI), then start the app:

```bash
pnpm dev
```

The app runs on http://localhost:3000.

### Demo mode without provider keys

Set `ENABLE_MOCK_PROVIDER=true` in `apps/web/.env.local`. The mock provider finishes every job after a few seconds with generated placeholder artwork and costs nothing, so you can work on the UI, the REST API and the MCP server without a fal.ai, Kie.ai or Higgsfield account. Put `[fail]` in a prompt to test the failure path. Use real keys only when you test a real model binding.

## Checks

Run these before you open a pull request. CI runs the same steps.

```bash
pnpm check                      # typecheck + tests + lint for every package
pnpm --filter web build         # production build of the web app
node --test scripts/*.test.mjs  # self-test of the repo scripts
pnpm check:public               # leak gate: secrets and private identifiers
```

Narrower loops while you work:

- `pnpm --filter @reflow/core test` (Vitest) and `pnpm --filter web test`
- `pnpm --filter @reflow/core typecheck`, `pnpm --filter web typecheck`
- `FAL_KEY=... pnpm --filter @reflow/core catalog:verify` checks fal bindings against fal's OpenAPI schemas

Every bug fix comes with a test that fails without the fix. Every new module comes with tests.

## Adding a model

A model is one `ModelDefinition` in `packages/core/src/catalog/models/image.ts`, `video.ts` or `utility.ts`. It describes the model once (parameters, media roles, aspect ratios, durations) and lists one `ProviderBinding` per provider that serves it.

1. Copy the closest existing definition and give it a stable snake_case `id`.
2. For each provider, fill in `endpoint` (fal endpoint id, Kie model slug or Higgsfield model id), `endpointByMode` when the provider has separate text, image or reference endpoints, and the `input` (`InputMappingSpec`) and `output` (`OutputMappingSpec`) mappings. Reuse the helpers in `_shared.ts`.
3. Add `pricing` with a `source` (a link to the provider's pricing page) and `verified_at` (ISO date).
4. Set `verified: false` on the binding. Only switch it to `true` after a real generation succeeded, and write in `notes` when and how you verified it.
5. Run `pnpm --filter @reflow/core test`. The catalog tests check ids, mappings and pricing shapes.

In the pull request, link the provider docs and pricing page and paste the cost estimate the app shows for a default request. Use the "Model request" issue form if you want a model but do not want to write the binding yourself.

## Adding a provider

A provider touches more places. Open an issue first so we can agree on the shape. The usual touch points:

- an adapter in `packages/core/src/providers/<id>/`, registered in `packages/core/src/providers/index.ts`
- the provider id in the shared id lists (core types, API and MCP schemas, the webhook route and the database enum through a new migration)
- key handling in Settings: help text, a key test, and an environment variable fallback in `apps/web/src/lib/env.ts` and `apps/web/.env.example`
- webhook verification in `/api/webhooks/<id>`, with poll-on-read as the fallback
- tests for request mapping, status parsing and webhook verification

## Database changes

- Add a new file `supabase/migrations/NNNN_short_name.sql` with the next number. Never edit a migration that has been released.
- Keep migrations additive and backward compatible for at least one release, so an instance can update code and database in either order.
- Turn on row level security for every new table.
- Update the row types in `apps/web/src/lib/db/types.ts` (they must stay `type` aliases, not interfaces).
- Add a "Needs action when updating" line to `CHANGELOG.md` that names the migration.

## Code style

- TypeScript strict mode, ESLint as configured. Match the style and comment density of the file you are in.
- Next.js 16 conventions: `proxy.ts` instead of middleware, `params`, `searchParams` and `cookies()` are Promises, `RouteContext<"/api/...">` types, `revalidateTag(tag, "max")`.
- Storage goes through the `StorageBackend` interface; provider calls go through the `ProviderRouter`. Do not call a provider or `db.storage` directly from a route.
- Keep the Higgsfield-compatible MCP tool names (`models_explore`, `generate_image`, `jobs_wait`, ...): MCP clients rely on them.
- No new runtime dependency without a short note in the PR on why it is needed.
- Write UTF-8 without a byte order mark and LF line endings (`.editorconfig` and `.gitattributes` set this up).

## Commits and pull requests

- Use a [Conventional Commits](https://www.conventionalcommits.org/) style title for your PR, for example `feat(catalog): add Veo 3.1 fast binding for Kie` or `fix(web): keep the prompt after a failed upload`. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`. PRs are squash-merged, so the PR title becomes the commit message.
- Describe what changed and why, and how you tested it. Add screenshots for UI changes.
- Add an entry under `## [Unreleased]` in `CHANGELOG.md` for anything a self-hoster notices, and fill in "Needs action when updating" when they have to run a migration, set an environment variable or change a setting.
- Update `apps/web/.env.example` and the docs when you add or rename an environment variable.

## AI coding agents

Contributions written with Claude Code, Codex, Cursor or other agents are welcome. Point your agent at [AGENTS.md](AGENTS.md): it lists the project map, the commands and the hard rules (no `.env` access, data-driven mappings, server-only modules). You stay responsible for what you submit: read the diff, run the checks yourself, and do not submit code you cannot explain. Do not let an agent read your `.env.local` or paste provider responses that contain keys or signed URLs into a PR.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of this project.
