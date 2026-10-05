# Provider APIs behind Reflow Studio

Reflow Studio calls three paid provider APIs (fal.ai, Kie.ai and the Higgsfield API) plus a free mock provider for demos. This page explains how keys are stored, how the router picks a provider and how costs are recorded. Setup steps are in [SETUP.md](SETUP.md#providers).

## One MCP endpoint for every agent

Claude Code, Codex, Cursor and other MCP clients all connect to `https://<your-host>/api/mcp` with an `rfl_` key from **Settings, API keys**. Provider secrets stay on the server. An agent picks a model with `models_explore`, optionally asks for `get_cost`, starts `generate_image` or `generate_video`, waits with `jobs_wait` and receives a direct file link. Some chat clients show an external image as an empty tile, so always pass the clickable link too. Client setup: [MCP.md](MCP.md).

## Configuring providers

1. Run every migration up to the current one (the build does this for you; see [SETUP.md](SETUP.md#database)). Migration `0006_higgsfield_provider.sql` adds `higgsfield` to the `provider_id` enum; `select enum_range(null::public.provider_id);` shows the values.
2. Paste keys in **Settings, Providers**. They are encrypted in the database with a key derived from `REFLOW_SECRET` (or the legacy `KEY_ENCRYPTION_SECRET`) and tested on save.
   - fal.ai: one API key.
   - Kie.ai: one API key.
   - Higgsfield API: a separate API account with a funded USD balance (plan credits on higgsfield.ai do not apply). Paste the key ID and secret as one value: `KEY_ID:KEY_SECRET`.
3. Headless alternative: the server-only variables `FAL_KEY`, `KIE_API_KEY` and `HIGGSFIELD_API_CREDENTIAL` (same `KEY_ID:KEY_SECRET` format). Keys saved in the app win. A change to environment variables needs a redeploy.
4. Leave the routing preference on `cheapest`, or pick a fixed provider (`fal`, `kie`, `higgsfield`) when you want to test one route on purpose.

Never share provider keys in chat, issues or public files.

## Model routes

- fal.ai and Kie.ai cover most of the catalog. Kie has its own routes for `gpt_image_2_5_flare` and `gpt_image_2_5_sunburst` (text and reference image), next to `gpt_image_2`.
- Higgsfield API: `soul_standard_api`, `soul_2_api`, `kling_2_5_turbo_pro_api`, `kling_2_5_turbo_standard_api`, `hailuo_2_3_standard_api`, plus text-to-video bindings on `seedance_2_0` and `seedance_2_5`. Seedance 2.5 through Higgsfield is limited to 480p and 720p and the documented text mode. Only documented request shapes are included.
- A new key does not add models by itself: every model needs a mapping for request, result and price in `packages/core/src/catalog/models/`. Bindings stay `verified: false` until a real generation succeeds.

## What `cheapest` does

The router compares the total estimate for the concrete request (resolution, duration, count) across the providers you have keys for, and only considers bindings that can serve that request exactly or with reported adjustments.

- **fal.ai and Kie.ai** use published catalog prices. Kie settles afterwards at the real `creditsConsumed` when Kie reports it.
- **Higgsfield** is asked for an account quote with the same fields. Some models return a numeric USD amount (for example Soul 2). Others, such as Seedance 2.0 and 2.5, return only a price description; the router then uses a public price estimate marked as unconfirmed (16:9, before discounts). That estimate can differ for other aspect ratios, discounts or cashback.

So the router picks the cheapest **known** valid route. It cannot guarantee the lowest invoice when a provider changes a price or applies a discount it does not publish. Compare only the same model and variant; Flare and Sunburst are separate choices.

The budget reservation covers the most expensive known candidate including fallbacks. A job whose submit timed out without a clear answer is never resent to another provider, so it cannot be charged twice.

## How costs are recorded

Every generation writes ledger entries: a reservation before submit, then a settlement or release.

- Kie: settled at the reported credits, converted to USD.
- fal.ai: settled at the catalog estimate unless fal reports a billed amount.
- Higgsfield: the callback carries no billed amount. The numeric quote or public estimate is booked as a provisional settlement and `cost_actual_usd` stays empty. The Higgsfield dashboard is the source of truth for the final charge.

Temporary Higgsfield cashback is not subtracted from quotes. Cashback is a separate promotional balance that only appears after the main balance is used, and model discounts do not apply when paying with it. If you want to spend that balance before it expires, set the preference to `higgsfield` on purpose; `cheapest` will not do it for you.

Set `MONTHLY_BUDGET_USD` to cap spend per calendar month ([SETUP.md](SETUP.md#budget)).

## Checking a new provider or model

1. Locally: core and web tests, typechecks, lint and a Next.js build.
2. After a preview or production deploy: MCP `models_explore` for the model, `generate_image` with `get_cost: true`, then one small real generation. Check the job status, the stored file, the direct link and the booked cost.
3. For Higgsfield, after adding the credential and a balance: check the status in Settings, one account quote, one Soul Standard image and one cheap video. Check the callback or polling, the stored copy, the ledger and the handling of a failed job.
4. Test the same MCP URL from at least two clients (for example Claude Code and Codex): tool discovery, `jobs_wait`, the clickable output link and any image preview separately. A stored file does not prove that every client renders the preview.
5. Test `cheapest` with two configured providers for the same model and settings. With one key this can only be shown with test adapters.

## Rolling back a provider

Set the routing preference to another provider, or remove the key in **Settings, Providers**. New jobs stop using that route. The enum value in Postgres can stay; removing a used enum value is not a routine rollback. Rolling back to an earlier Vercel deployment also works, but let running jobs on that provider finish or cancel them first and check the ledger.

## Sources

- Kie GPT Image 2.5: https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image
- Higgsfield API docs: https://docs.higgsfield.ai/docs/llms.txt
- Higgsfield requests and results: https://docs.higgsfield.ai/docs/concepts/requests
- Higgsfield pricing quotes: https://docs.higgsfield.ai/docs/concepts/billing-and-retention
- Higgsfield authentication: https://docs.higgsfield.ai/docs/authentication
- Higgsfield Seedance 2.5 text-to-video API: https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference
- Higgsfield cashback order: https://open.higgsfield.ai/cashback?tab=how-it-works
