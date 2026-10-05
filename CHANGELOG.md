# Changelog

All notable changes to Reflow Studio are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version starts with 0, a minor release (0.2.0) may need a database migration or a new environment variable; a patch release (0.1.1) never does.

## Updating your instance

Every release starts with a **Needs action when updating** section that lists everything you have to do by hand, in this order:

1. **Environment:** variables that are new, renamed or removed. Set them in Vercel (or `apps/web/.env.local`) before the new code deploys.
2. **Database:** migrations from `supabase/migrations/` that the release adds. When your deployment applies migrations during the build, the next deploy runs them; otherwise run them yourself in numeric order (Supabase SQL Editor or `supabase db push`).
3. **Settings:** anything to change in Supabase, Vercel, Cloudflare or in the app itself.

"None" means you can sync your fork and let Vercel redeploy. When you skip releases, read every entry between your version and the new one, not only the latest.

**Contributors:** add your change under `[Unreleased]` in the right group (Added, Changed, Deprecated, Removed, Fixed, Security) and fill in "Needs action when updating" whenever a self-hoster has to set a variable, run a migration or change a setting.

## [Unreleased]

### Needs action when updating

None yet.

## [0.1.0] - 2026-10-05

First public release.

### Needs action when updating

- **New instance:** follow [docs/SETUP.md](docs/SETUP.md). It covers the environment variables (full list with comments in `apps/web/.env.example`). Production builds apply every migration in `supabase/migrations/` (`0001` up to and including `0008`) when a database URL is available; otherwise apply them yourself in numeric order.
- **Instance created from the private pre-release:** apply `0007_security_and_scale.sql` and `0008_shares.sql`, in that order (or set `REFLOW_MIGRATE_BASELINE=0006` plus a database URL and let the build do it), and compare your environment with `apps/web/.env.example`. Existing `WEBHOOK_SECRET`, `RECONCILE_SECRET` and `KEY_ENCRYPTION_SECRET` values keep working; keep `KEY_ENCRYPTION_SECRET` set so stored provider keys stay readable.

### Added

- Web studio for image and video generation with reference media, a model picker with cost estimates, and a library of generations and uploaded media.
- REST API under `/api/v1` and a remote MCP server at `/api/mcp` with Higgsfield-compatible tool names (`models_explore`, `generate_image`, `generate_video`, `jobs_wait`, `media_upload`, `media_import_url`, ...), authenticated with `rfl_` API keys from Settings.
- Bring-your-own-key providers: fal.ai, Kie.ai and the Higgsfield API. Keys are saved encrypted in Settings, Providers, or read from environment variables. A mock provider runs demos and local development without any key.
- Model catalog defined as data, cost estimates per request, routing to the cheapest available provider with fallback, and an optional monthly spend cap (`MONTHLY_BUDGET_USD`).
- Signed provider webhooks, with poll-on-read and a scheduled reconcile job as safety nets. Every output is copied into your own storage: Cloudflare R2 when configured, Supabase Storage otherwise.
- Owner-only access: `OWNER_EMAILS` decides who can sign in and whose API keys work.
- One deploy secret: `REFLOW_SECRET` (32+ characters) replaces the separate webhook, reconcile and key-encryption secrets, which are derived from it.
- Build-time migrations: production builds apply `supabase/migrations/`, write the reconciler's Vault secrets and sync the sign-up allowlist from `OWNER_EMAILS`.
- A `/setup` page that shows a configuration checklist and creates the first owner account without sending e-mail.
- Database support for share links (`0008_shares.sql`). The share UI is not part of this release.
- Open-source project files: MIT license, contributing guide, security policy, code of conduct, issue forms, pull request template, Dependabot, and CI with typecheck, tests, lint, a production build, a secret scan and a leak gate.

### Security

- New accounts are refused in the database unless their email is on the owner allowlist, and client write policies that the app never uses are dropped (`0007_security_and_scale.sql`).

[Unreleased]: https://github.com/reflow-automations/reflow-studio-oss/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/reflow-automations/reflow-studio-oss/releases/tag/v0.1.0
