# Research dossier (2026-09-05)

Research run (several dimensions, each independently fact-checked) that informed the architecture. Facts marked `(unverified)`, `[M]` or `[U]` were not confirmed against primary sources; the sandbox could not reach fal.ai / kie.ai / supabase.com / vercel.com directly, so many facts come from official docs mirrored on GitHub, npm/PyPI metadata and search snippets.

| File | Content |
|---|---|
| `00-dossier.md` | Synthesis: executive summary, provider landscape, architecture decisions, roadmap, cost model, risks. |
| `01-fal-ai-api.md` | fal.ai queue API, webhooks (ED25519/JWKS), storage, SDKs, platform APIs (models/pricing/usage), model catalog with endpoint ids and prices, plus the fact-check. |
| `02-kie-ai-api.md` | Kie.ai endpoint families (jobs, Veo, Suno…), callbacks (HMAC), file upload, credit pricing, model slugs and request fields, reliability/ToS, plus the fact-check. |
| `03-higgsfield-to-provider-mapping.md` | Every Higgsfield model/tool mapped to fal / Kie / other providers with fidelity and prices; approximation strategies for proprietary features; provider prioritisation; drop/defer list; fact-check. |
| `04-reference-stack.md` | Open-source references, Vercel AI SDK status, async job architecture on Vercel + Supabase, storage, data model, frontend, auth/MCP, ops, testing. |
| `06-higgsfield-product.md` | Higgsfield product surfaces, plans and credits from public pricing pages, public API/SDK, company facts. |
| `07-mcp-architecture.md` | MCP spec 2026-07-28 deltas, authorization for Claude.ai/Claude Code/Cursor, MCP Apps status, tool-design lessons from media MCP servers, security. |

Numbers 05 and 08 to 10 are internal notes that are not part of the public repository.
