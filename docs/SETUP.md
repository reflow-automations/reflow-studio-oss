# Setup guide

This guide takes you from zero to a running Reflow Studio on free tiers: Vercel for the app, Supabase for login and the database, and optionally Cloudflare R2 for media. Reading it top to bottom takes about ten minutes; the deploy itself takes about five.

The `/setup` page of your deployment shows a checklist. Each item links to a section below.

**Contents:** [What you need](#what-you-need) · [Deploy with Vercel](#deploy-with-vercel) · [Bring your own Supabase](#bring-your-own-supabase) · [Supabase](#supabase) · [Secrets](#secrets) · [Owner](#owner) · [Environment](#environment) · [Database](#database) · [Providers](#providers) · [Storage](#storage) · [Reconciler](#reconciler) · [Budget](#budget) · [Connect an MCP client](#connect-an-mcp-client) · [Updating](#updating) · [Local development](#local-development) · [REST API](#rest-api) · [Troubleshooting](#troubleshooting)

## What you need

- A GitHub account and a Vercel account (Hobby is free).
- A Supabase account (Free plan). The Vercel deploy button can create the project for you.
- At least one provider key (fal.ai, Kie.ai or the Higgsfield API) to generate real media. Without a key you can run the free [mock provider](#providers).
- Optional: a Cloudflare account for R2 storage.

### Free tier limits

| Service | Limit | What it means for you |
|---|---|---|
| Supabase Free | 500 MB database, 1 GB file storage, 50 MB per file | Fine for images. For regular video use, add [R2 storage](#storage). |
| Supabase Free | Projects pause after one week without activity; 2 free projects per account | Open the studio now and then, or restore the project from the Supabase dashboard. |
| Vercel Hobby | Personal, non-commercial use only | Paid client work needs Vercel Pro. |
| Vercel Hobby | Functions run up to 300 s; cron jobs at most once a day | That is why the [reconciler](#reconciler) runs inside Postgres with pg_cron. |
| Cloudflare R2 | 10 GB storage free, no egress fees | Cloudflare asks for a payment method before you can enable R2. |

### Regions

`apps/web/vercel.json` pins the serverless functions to `dub1` (Dublin). Create your Supabase project in `eu-west-1` (Ireland) so the app and the database sit next to each other. If you and your users are outside Europe, change both: for example `iad1` in `vercel.json` and `us-east-1` in Supabase. A function far from its database makes every page noticeably slower.

## Deploy with Vercel

This is the recommended path. The button in the [README](../README.md) does all of this:

1. Copies the repository to your GitHub account and creates a Vercel project with root directory `apps/web`.
2. Adds the Supabase integration, which creates a Supabase project and injects its keys and database URLs as environment variables. Pick the region from [Regions](#regions) when Vercel asks.
3. Asks for three values:
   - `OWNER_EMAILS`: the e-mail address you will sign in with (see [Owner](#owner)).
   - `REFLOW_SECRET`: one random string of 32 or more characters (see [Secrets](#secrets)).
   - `MONTHLY_BUDGET_USD`: your monthly spend cap, default `10` (see [Budget](#budget)).
4. Builds the app. The production build creates every database table (see [Database](#database)).

When the deploy is green:

1. Open `https://<your-app>.vercel.app/setup`. The checklist should be green except for the owner account and providers.
2. Create your owner account on that page (see [Owner](#owner)).
3. Paste a provider key in **Settings, Providers**, or turn on the mock provider.
4. Generate your first image.

## Bring your own Supabase

Use this when you already have a Supabase project, want to pick its settings yourself, or do not want the Vercel integration.

1. Create a project on [supabase.com](https://supabase.com) (Free plan is fine) in the region from [Regions](#regions). Save the database password.
2. Collect five values from the Supabase dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`: Project Settings, Data API, Project URL (`https://<project-ref>.supabase.co`).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings, API Keys, the publishable key (`sb_publishable_...`) or the legacy `anon` key.
   - `SUPABASE_SERVICE_ROLE_KEY`: same page, the secret key (`sb_secret_...`) or the legacy `service_role` key. Server only.
   - `SUPABASE_DB_URL`: click **Connect** at the top of the dashboard and copy the **Session pooler** connection string. Replace `[YOUR-PASSWORD]` with your database password. Do not use the direct `db.<project-ref>.supabase.co` host: it is IPv6 only and Vercel builds cannot reach it.
   - `OWNER_EMAILS` and `REFLOW_SECRET` as described in [Owner](#owner) and [Secrets](#secrets).
3. Deploy with this button. It asks for the six variables above and does not add the integration:

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Freflow-automations%2Freflow-studio-oss&root-directory=apps%2Fweb&project-name=reflow-studio&repository-name=reflow-studio&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_DB_URL,OWNER_EMAILS,REFLOW_SECRET)

4. Add `MONTHLY_BUDGET_USD` afterwards in Vercel, Project Settings, Environment Variables, and redeploy.
5. Continue with step 1 of "When the deploy is green" above.

You can also import the repository by hand in Vercel: set **Root Directory** to `apps/web` and add the same variables.

## Supabase

The app needs the project URL, a public key and a server key. It accepts the names that the Vercel Supabase integration injects, so you do not have to rename anything:

| Purpose | Accepted names (the first one wins when several are set) |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL` |
| Public key (browser) | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY` |
| Server key (never in the browser) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` |
| Database URL for migrations | `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL`, `SUPABASE_DB_URL` |

The public key is safe in the browser because every table has row level security and new accounts are limited to `OWNER_EMAILS` in the database itself.

In Supabase, Authentication, URL Configuration, set the **Site URL** to your deployment URL and add `https://<your-app>/auth/callback` to the redirect URLs. Magic links and password reset e-mails use these.

### Why there is a /setup page

Supabase's built-in e-mail sender is meant for testing. It sends only a few messages per hour and, on new projects, only to addresses of members of your Supabase organization. A sign-up that waits for a confirmation e-mail can therefore get stuck. The `/setup` page avoids e-mail completely: it creates your first account already confirmed. For password reset or magic links in production, configure custom SMTP in Supabase, Authentication, Emails.

## Secrets

`REFLOW_SECRET` is the only secret you have to create. It must be at least 32 characters. The app derives three internal secrets from it: the webhook signing secret, the reconciler secret and the key that encrypts provider keys in the database. You also type it once on `/setup` to prove you own the deployment.

Generate one with any of these:

```bash
# Node (any OS)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```powershell
# Windows PowerShell 5.1
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

```bash
# macOS or Linux
openssl rand -base64 32
```

Keep the value stable. A new `REFLOW_SECRET` makes provider keys saved in the app unreadable (paste them again in Settings, Providers) and invalidates webhook links of jobs that are still running (the reconciler still finishes them).

**Legacy secrets.** Deployments created before `REFLOW_SECRET` used `WEBHOOK_SECRET`, `RECONCILE_SECRET` and `KEY_ENCRYPTION_SECRET`. They are optional now. When set, each one wins over the derived value, so an existing deployment keeps working without changes. Keep `KEY_ENCRYPTION_SECRET` set if you already stored provider keys with it. At least one of `REFLOW_SECRET` or `WEBHOOK_SECRET` is required.

## Owner

Reflow Studio is a personal studio. `OWNER_EMAILS` lists the e-mail addresses that may use it, comma-separated (`you@example.com,partner@example.com`).

It is enforced twice:

- **In the app:** pages, server actions, the REST API and API keys only work for listed addresses. In production an empty `OWNER_EMAILS` blocks everyone, so a forgotten variable cannot expose your studio.
- **In the database:** a trigger on `auth.users` refuses every new account whose address is not on an allowlist (`private.allowed_emails`). Each production build copies `OWNER_EMAILS` into that list. Someone who calls Supabase Auth directly with your public key still cannot create an account.

### Create the first owner account

1. Open `https://<your-app>/setup`.
2. Enter an address from `OWNER_EMAILS`, a password (8 to 72 characters) and your `REFLOW_SECRET`.
3. The page creates the account, confirmed, and signs you in. No e-mail is sent.

Five wrong secrets from one client lock the form for 15 minutes. Once an owner account exists, `/setup` no longer creates accounts.

### Add or remove an owner later

Change `OWNER_EMAILS` in Vercel and redeploy. The build updates the database allowlist. The new person can then create an account (sign up on `/login` if `ALLOW_SIGNUP=true`, or add the user in Supabase, Authentication, Users, with "Auto Confirm"). Removing an address stops that person's sessions and API keys after the redeploy.

If your build does not run migrations (see [Database](#database)), update the allowlist by hand in the Supabase SQL Editor:

```sql
select public.sync_allowed_emails(array['you@example.com']);
```

The call replaces the whole list. You may also turn off "Allow new users to sign up" in Supabase, Authentication, Sign In / Providers. `/setup` still works then, because it creates the account through the admin API.

## Environment

Required variables are covered above: Supabase ([Supabase](#supabase)), `REFLOW_SECRET` ([Secrets](#secrets)) and `OWNER_EMAILS` ([Owner](#owner)). The full list with comments is in [`apps/web/.env.example`](../apps/web/.env.example). The ones you are most likely to set:

| Variable | Default | Purpose |
|---|---|---|
| `MONTHLY_BUDGET_USD` | no cap | Hard spend cap per calendar month. See [Budget](#budget). |
| `APP_BASE_URL` | `https://$VERCEL_PROJECT_PRODUCTION_URL` on Vercel, `http://localhost:3000` locally | Public URL used for provider webhooks and the reconciler. Set it when you use a custom domain. It must be the exact public URL. |
| `ENABLE_MOCK_PROVIDER` | off | Free demo provider. See [Providers](#providers). |
| `FAL_KEY`, `KIE_API_KEY`, `HIGGSFIELD_API_CREDENTIAL` | none | Provider keys for headless setups. Keys saved in the app win. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | Supabase Storage | See [Storage](#storage). |
| `PROVIDER_STRATEGY`, `PROVIDER_PREFERENCE` | `preferred`, `kie,fal,higgsfield` | Routing defaults (`preferred` or `cheapest`, and the provider order). The preference saved in Settings wins. |
| `ALLOW_SIGNUP` | `false` | Shows "Create account" on the login page. The database allowlist still applies. |
| `REFLOW_MIGRATE_BASELINE`, `REFLOW_SKIP_MIGRATIONS` | unset | See [Database](#database). |

Empty values count as unset. After changing variables in Vercel, redeploy: running deployments do not pick up changes.

## Database

Production builds apply the SQL migrations in `supabase/migrations/` before `next build` runs (`apps/web/scripts/migrate.mjs`):

- **Database URL.** The script uses the first of `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL` or `SUPABASE_DB_URL`. The Vercel Supabase integration sets the first two. With your own Supabase project, set `SUPABASE_DB_URL` to the **Session pooler** string ([Bring your own Supabase](#bring-your-own-supabase)).
- **Production only.** On Vercel, preview builds skip the step so a pull request never changes your database. Without a database URL the step is skipped as well and the log says so.
- **History.** Applied migrations are recorded in `supabase_migrations.schema_migrations`, the same table the Supabase CLI uses, so each file runs once.
- **Extra steps.** After the migrations the script writes the reconciler's Vault secrets ([Reconciler](#reconciler)) and syncs the sign-up allowlist from `OWNER_EMAILS` ([Owner](#owner)).
- **Failure.** If a migration fails, the build stops and your previous deployment stays live. The build log shows the error.

`/setup` compares the schema version in the database with the version the code needs and tells you when a migration is missing.

What the migrations create:

- `0001`: workspaces and members, profiles, generations and outputs, media assets, folders, elements, API keys (hashed), the cost ledger, provider events, storage buckets `media` and `uploads` (private, signed URLs), a realtime trigger.
- `0002`: the pg_cron reconciler ([Reconciler](#reconciler)).
- `0003`: encrypted provider keys (service role only).
- `0004`: prompt, model and title on media assets for library search.
- `0005`: hardening of functions and grants.
- `0006`: the `higgsfield` provider.
- `0007`: database sign-up allowlist, budget reservation in one transaction, read-only client policies, retention job, indexes.
- `0008`: tables for share links (no UI yet).

### Databases migrated by hand

If you applied migrations earlier through the SQL Editor or another tool, the history table may be empty and the build refuses to run them again. Set `REFLOW_MIGRATE_BASELINE` to the number of the last migration that is already in place (for example `0006`) and redeploy. The build records `0001` up to that number as applied and runs the rest.

### Running migrations yourself

Set `REFLOW_SKIP_MIGRATIONS=true` and apply the files in numeric order, either in the Supabase SQL Editor or with the Supabase CLI (`supabase link --project-ref <project-ref>` and `supabase db push`). Then sync the allowlist ([Owner](#owner)) and set the Vault secrets ([Reconciler](#reconciler)) yourself.

## Providers

Paste keys in **Settings, Providers** after you sign in. They are encrypted (AES-256-GCM) with a key derived from `REFLOW_SECRET`, tested on save, and never sent to the browser or through MCP.

| Provider | Where to get a key | Notes |
|---|---|---|
| fal.ai | https://fal.ai/dashboard/keys | Widest catalog. Pay as you go. |
| Kie.ai | https://kie.ai/api-key | Often the cheapest route. Credits are converted to USD. |
| Higgsfield API | https://console.higgsfield.ai | Needs a funded API balance; plan credits on higgsfield.ai do not apply. Paste `KEY_ID:KEY_SECRET` as one value. |

The same page sets the routing preference: `cheapest`, `fal`, `kie` or `higgsfield`. With `cheapest` the router picks the cheapest configured provider for each request; with a fixed provider it tries that one first. In both cases it falls back to another configured provider when a provider clearly rejects the job. Without a saved preference the router uses `PROVIDER_STRATEGY` and `PROVIDER_PREFERENCE` ([Environment](#environment)). Details: [API-PROVIDERS.md](API-PROVIDERS.md).

Environment variables (`FAL_KEY`, `KIE_API_KEY`, `HIGGSFIELD_API_CREDENTIAL`) work as a fallback when nothing is saved in the app. `KIE_WEBHOOK_SECRET` (the HMAC key from Kie, Settings, Webhook signing) turns on signature checks for Kie callbacks.

### Demo mode without keys

Set `ENABLE_MOCK_PROVIDER=true` to try the whole studio, REST API and MCP server without any provider key:

- Every generation costs $0 and returns an SVG placeholder after a few seconds. Video, audio and 3D requests also return an image placeholder.
- Put `[fail]` anywhere in a prompt to see how a failed job looks.
- The mock is a last-resort route: once you add a real key, that provider always wins.

## Storage

Every output, import and upload is copied into your own storage. Without configuration that is Supabase Storage (Free plan: 1 GB total, 50 MB per file), which is enough for images. For video, add Cloudflare R2 (10 GB free, no egress fees; Cloudflare asks for a payment method to enable R2).

1. Cloudflare dashboard, R2: create a bucket, for example `reflow-studio`.
2. R2, Manage API tokens: create a token and note the Access Key ID, Secret Access Key and your Account ID. **Object Read & Write** on that bucket is enough to store and serve media. The **Apply CORS** button (step 4) needs **Admin Read & Write**; with an Object token, add the CORS rule by hand instead.
3. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in Vercel and redeploy. All four are needed; with fewer the app keeps using Supabase Storage.
4. Open **Settings, Providers, Storage**, click **Test connection**, then allow browser uploads to the bucket: click **Apply CORS**, or add this rule in Cloudflare, R2, your bucket, Settings, CORS Policy. Use your deployment URL as the first origin. `AllowedHeaders` is required because uploads send a `Content-Type` header.

   ```json
   [
     {
       "AllowedOrigins": ["https://<your-app>.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["Content-Length", "Content-Type", "ETag"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```

Leave `R2_PUBLIC_URL` empty to keep the bucket private: the app then serves media through presigned URLs (valid 6 hours), which providers can also fetch. Set it only to a custom domain connected to the bucket. `r2.dev` URLs are rate limited and meant for development.

Older objects in Supabase Storage stay readable after you switch: each asset records where it lives. Object keys look like `<workspace>/<yyyy>/<mm>/<asset-id>.<ext>`.

## Reconciler

Providers report finished jobs through signed webhooks. When a webhook never arrives, the reconciler polls the provider. Vercel Hobby cron jobs run only once a day, so the schedule lives in Postgres: pg_cron calls `/api/internal/reconcile` every minute through pg_net, and only when a job is actually waiting. Reading a running job in the UI, API or MCP also refreshes it.

The production build sets this up for you: migration `0002` enables pg_cron and pg_net, and the migrate script stores `app_base_url` and `reconcile_secret` in Supabase Vault. Check the result in the SQL Editor:

```sql
select public.studio_reconcile_config();
```

All values should be `true`. If you manage the database yourself, set `RECONCILE_SECRET` explicitly in Vercel (16 or more characters) so you know its value, then store both secrets:

```sql
select vault.create_secret('https://<your-app>.vercel.app', 'app_base_url');
select vault.create_secret('<RECONCILE_SECRET>', 'reconcile_secret');
```

Any other scheduler can call `POST https://<your-app>/api/internal/reconcile` with `Authorization: Bearer <RECONCILE_SECRET>` instead.

A second daily job (`reflow-retention-daily`) prunes old provider event payloads.

## Budget

`MONTHLY_BUDGET_USD` is a hard cap on provider spend per calendar month (UTC). `0` or unset means no cap.

- Before a job is submitted, the studio reserves the highest cost estimate among the providers that could run it, including fallbacks. If settled plus reserved spend would cross the cap, the job is refused with `insufficient_credits` and nothing is sent to a provider.
- When the job finishes, the reservation is settled at the reported cost (Kie) or the estimate, or released when the job fails.
- The check and the reservation run in one database transaction, so parallel requests cannot overshoot the cap.
- Higgsfield does not report billed amounts; its charges are booked at the quote. Check the Higgsfield dashboard for exact numbers.

The `balance` MCP tool and `GET /api/v1/balance` show month-to-date spend and the cap. Start low (the deploy button suggests `10`) and raise it when you know your usage.

## Connect an MCP client

Create an API key in **Settings, API keys**, then add the server to your client. Replace `<your-app>` with your host and `rfl_...` with the key.

**Claude Code**

```bash
claude mcp add --transport http reflow-studio https://<your-app>/api/mcp --header "Authorization: Bearer rfl_..."
```

**Codex**

```bash
export REFLOW_STUDIO_API_KEY="rfl_..."
codex mcp add reflow-studio --url https://<your-app>/api/mcp --bearer-token-env-var REFLOW_STUDIO_API_KEY
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.reflow-studio]
url = "https://<your-app>/api/mcp"
bearer_token_env_var = "REFLOW_STUDIO_API_KEY"
```

**Cursor** (`~/.cursor/mcp.json`) and other Streamable HTTP clients:

```json
{ "mcpServers": { "reflow-studio": { "url": "https://<your-app>/api/mcp", "headers": { "Authorization": "Bearer rfl_..." } } } }
```

**Claude Desktop** and other stdio-only clients, through `mcp-remote` (needs Node):

```json
{
  "mcpServers": {
    "reflow-studio": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-app>/api/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer rfl_..." }
    }
  }
}
```

Tools, arguments and the typical flow: [MCP.md](MCP.md). Keys have scopes (`read`, `generate`, `admin`); a key with only `read` can explore models and estimate costs but cannot start jobs.

## Updating

The deploy button copies the repository into your account; it is not a GitHub fork. Pull updates from the public repository like this:

```bash
git remote add upstream https://github.com/reflow-automations/reflow-studio-oss.git   # once
git fetch upstream
git merge upstream/main
git push origin main
```

Read the "Needs action when updating" part of every [CHANGELOG](../CHANGELOG.md) entry between your version and the new one before you push. Vercel redeploys on push, and the production build applies new migrations automatically.

## Local development

Requirements: Node 22.12 or newer and pnpm 10 (through corepack).

```bash
git clone https://github.com/reflow-automations/reflow-studio-oss.git
cd reflow-studio-oss
corepack enable
pnpm install
cp apps/web/.env.example apps/web/.env.local
```

Fill in the Supabase values and `REFLOW_SECRET` in `apps/web/.env.local` (a separate free Supabase project for development is a good idea). `OWNER_EMAILS` may stay empty in development. Then create the tables and start the app:

```bash
pnpm --filter web exec node --env-file=.env.local scripts/migrate.mjs
pnpm dev
```

Open http://localhost:3000/setup to create your account. Set `ENABLE_MOCK_PROVIDER=true` to work without provider keys. Providers cannot send webhooks to `localhost`, so local jobs finish through poll-on-read while the page is open.

Checks before a pull request: `pnpm check` (typecheck, tests and lint for every package). See [CONTRIBUTING.md](../CONTRIBUTING.md).

## REST API

All routes accept a Supabase session cookie (browser) or `Authorization: Bearer rfl_...`.

| Method and path | Purpose |
|---|---|
| `GET /api/v1/models?type=&capability=&q=` | Model catalog (same data as `models_explore`). |
| `POST /api/v1/generations` | Submit `{ model, prompt, aspect_ratio, duration, count, medias, params, provider?, get_cost? }`. |
| `GET /api/v1/generations?type=&state=&before=` | History with cursor pagination. |
| `GET /api/v1/generations/:id` | Details; refreshes from the provider while running. |
| `DELETE /api/v1/generations/:id` | Cancel. |
| `POST /api/v1/generations/delete` | Delete `{ ids[] }` (1 to 100) finished generations and the media they produced; running ones are skipped, spend history stays. |
| `POST /api/v1/generations/wait` | Long-poll `{ ids[], timeout_seconds }` (up to 25 s). |
| `POST /api/v1/estimate` | Cost preflight. |
| `GET /api/v1/media?type=&q=` · `POST /api/v1/media` · `POST /api/v1/media/:id/confirm` · `POST /api/v1/media/import` | Assets: list and search, presigned upload, confirm, import from URL. |
| `POST /api/v1/media/delete` | Delete `{ ids[] }` (1 to 100) assets and their storage objects. |
| `GET /api/v1/balance` | Ledger totals and provider balances. |
| `GET /api/v1/status` | Provider key status (hints only), routing preference, storage backend, budget. |
| `POST /api/webhooks/{fal,kie,higgsfield}` | Provider callbacks (signature and per-job token verified). |
| `POST /api/internal/reconcile` | Poll unfinished generations (bearer reconcile secret). |

### Verifying the catalog

Model request schemas in `packages/core/src/catalog/models/*.ts` are data. Bindings are marked `verified: false` until checked against the provider. `pnpm --filter @reflow/core catalog:verify plan` lists every request body offline; with `FAL_KEY` set, `catalog:verify` diffs fal bindings against fal's OpenAPI documents and `catalog:prices` compares prices. Kie.ai publishes no machine-readable schema: verify with one cheap live call per model and record the result in the binding's `notes`.

## Troubleshooting

- **`/setup` says Supabase is not configured.** The Supabase variables are missing or empty in this deployment. Add them and redeploy.
- **Build log: `[migrate] skipped: no database URL`.** Set `SUPABASE_DB_URL` (bring your own Supabase) or check that the Supabase integration is connected, then redeploy.
- **Build fails with "already has the Reflow Studio schema".** See [Databases migrated by hand](#databases-migrated-by-hand).
- **Build fails with `cannot connect`.** Use the Session pooler string, not the direct database host, and check the password.
- **"Database error saving new user" when signing up.** The address is not in the database allowlist. Add it to `OWNER_EMAILS` and redeploy.
- **Jobs stay "running".** Check the [Reconciler](#reconciler) and that `APP_BASE_URL` (if set) is your exact public URL.
- **Uploads fail in the browser with R2.** The bucket's CORS rule is missing or does not list your URL ([Storage](#storage)).
- **Supabase project paused.** Free projects pause after a week without activity. Restore it in the Supabase dashboard.
