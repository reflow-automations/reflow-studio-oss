## What and why

<!-- What does this change, and why? Link the issue it closes, for example "Closes #123". -->

## Type of change

- [ ] Model binding (catalog data only)
- [ ] Provider adapter
- [ ] Bug fix
- [ ] Feature (web app, REST API or MCP)
- [ ] Database migration
- [ ] Docs, CI or tooling

## How I tested it

<!--
Commands you ran. For a model binding: the live generation you ran (date, provider, model and the cost the app showed), or say that it is untested.
Screenshots for UI changes.
-->

## Checklist

- [ ] `pnpm check` and `pnpm --filter web build` pass on my machine.
- [ ] Bug fixes and new modules come with tests.
- [ ] New model bindings keep `verified: false`, unless I ran a real generation and wrote the date and method in `notes`.
- [ ] Database changes are new migration files, additive and backward compatible, with row level security on new tables.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`, including "Needs action when updating" when self-hosters must set a variable, run a migration or change a setting.
- [ ] New or renamed environment variables are in `apps/web/.env.example` and the docs.
- [ ] No secrets, keys, signed URLs or personal data in the code, the tests, the screenshots or this description.
