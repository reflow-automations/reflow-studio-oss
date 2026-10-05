# MCP server reference

Endpoint: `POST https://<host>/api/mcp` (Streamable HTTP, MCP spec 2026-07-28 with fallback for 2025-era clients). Auth: `Authorization: Bearer rfl_…` (create keys in Settings → API keys). Server name `reflow-studio`.

## Typical flow

```
models_explore(action="search", query="image to video kling")   → pick a model id, read its media roles + parameters
media_import_url(url="https://…/product.png")                    → asset_id
generate_video(model="kling_3_0", prompt="…", aspect_ratio="9:16", duration=5,
               medias=[{role:"start_image", value:"<asset_id>"}], params={mode:"pro"})
jobs_wait(ids=["<generation_id>"])                                → repeat while all_terminal=false
```

Add `get_cost: true` to `generate_*` to get an estimate without submitting (Higgsfield `get_cost`). Responses carry `adjustments` when parameters were clamped or coerced.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `models_explore` | `action` list\|search\|get, `type` image\|video\|audio\|3d, `capability`, `provider`, `query`, `model_id`, `limit` | Compact catalog rows (id, vendor, capabilities, aspect ratios, durations, media roles, parameters, providers with price/unit, Higgsfield ids replaced) or the full definition for `get`. |
| `generate_image` | `model`, `prompt`, `negative_prompt`, `aspect_ratio`, `count` 1-4, `medias[{role,value}]`, `params`, `provider`, `get_cost` | `{ id, state, provider, cost_estimate_usd, adjustments }` or a cost estimate. |
| `generate_video` | as above plus `duration` (seconds) | same |
| `jobs_wait` | `ids[]` (1-12), `timeout_seconds` ≤ 20 | `{ all_terminal, poll_after_seconds, items[{ id, state, progress, error, cost_actual_usd, outputs[{ kind, url, width, height, duration_seconds }] }] }` |
| `get_generation` | `id` | Full generation view (request, adjustments, provider, outputs, cost, error). |
| `show_generations` | `limit`, `before` (cursor), `type`, `state` | History with `next_cursor`. |
| `cancel_generation` | `id` | Updated generation. |
| `media_import_url` | `url` (https), `type` | `{ asset_id, kind, status }` |
| `media_upload` | `filename`, `content_type` | `{ asset_id, upload_url, method: "PUT", headers, curl }`, PUT the bytes, then `media_confirm`. |
| `media_confirm` | `asset_id` | `{ asset_id, kind, status, bytes }` |
| `show_medias` | `type`, `q` (search prompt/title), `model`, `limit`, `before` | Assets with URLs plus their prompt / model id, the studio's memory of past outputs. |
| `balance` | - | `{ spent_usd, reserved_usd, month_to_date_usd, monthly_budget_usd, providers[{ provider, native, unit, usd }] }` |
| `studio_status` | - | `{ providers[{ provider, source app\|env\|none, key_hint, status, last_error }], provider_preference, storage{ kind, bucket, public_url }, encryption_configured, monthly_budget_usd, month_to_date_usd }`, never secrets. |
| `set_provider_preference` | `preference` cheapest\|fal\|kie\|higgsfield | `{ provider_preference }` |

Provider keys are configured in the web app (Settings → Providers) or via environment variables; an agent that sees a missing/invalid provider in `studio_status` should send the user there rather than ask for a key in chat.

Media roles (from the model definition): `image`, `image_references`, `start_image`, `end_image`, `mask`, `video`, `video_references`, `audio`, `audio_references`. Values are asset ids or generation ids, never raw URLs (import them first).

## Client configuration

Claude Code:

```bash
claude mcp add --transport http reflow-studio https://<host>/api/mcp --header "Authorization: Bearer rfl_…"
```

Cursor / any Streamable-HTTP client (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "reflow-studio": { "url": "https://<host>/api/mcp", "headers": { "Authorization": "Bearer rfl_…" } } } }
```

stdio-only clients: `npx -y mcp-remote https://<host>/api/mcp --header "Authorization: Bearer rfl_…"`.

Claude.ai custom connectors expect OAuth; that phase will use Supabase's OAuth 2.1 server as the authorization server (`MCP_OAUTH_ISSUERS` feeds `/.well-known/oauth-protected-resource`).

## Differences from Higgsfield's MCP

- No widgets (MCP Apps) yet: results are JSON with public (R2) or signed URLs; hosts that render markdown images can show them inline.
- `generate_*_batch` and `show_generation_by_ids` are not needed: call `generate_*` several times (each returns immediately) and pass the ids to `jobs_wait`.
- No `use_unlim` / trial mechanics; costs are USD estimates per provider.
- Elements (`<<<uuid>>>` placeholders), characters, presets and workflows are roadmap items.
