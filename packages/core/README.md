# @reflow/core

The provider-agnostic core of Reflow Studio: the model catalog, the fal.ai, Kie.ai and Higgsfield API adapters, an offline mock provider, request normalisation, cost estimation and routing. It has no framework or database dependencies, so the web app, scripts and tests all use the same code.

## What is in here

| Path | Purpose |
| --- | --- |
| `src/catalog/models/*.ts` | The seed catalog. Provider request and response shapes are data (`InputMappingSpec`, `OutputMappingSpec`), never per-model code. |
| `src/catalog/normalize.ts` | `normalizeRequest(model, request)`: validates a request against the model and reports every change as an adjustment. |
| `src/catalog/mapping.ts` | `effectiveRequest` (what one binding will actually run), `prepareProviderRequest` (endpoint plus body), `extractOutputs`. |
| `src/cost/index.ts` | `estimateCost(model, binding, request)`: a pre-flight estimate of exactly the request a binding will run. |
| `src/router/index.ts` | `ProviderRouter`: picks a binding per request and falls back only when that is safe. |
| `src/providers/*` | One adapter per provider plus `PROVIDER_INFO`. |

## Request flow

1. `normalizeRequest` checks the request against the model (ratios, durations, media roles, parameters).
2. `ProviderRouter.candidates` keeps the bindings that can serve it: the input mode is supported, parameter values are accepted, and every media role in the request is mapped (reference media are never dropped silently). Bindings that serve the request exactly rank before bindings that would change it (a pinned tier, a clamped duration, one output per job).
3. The adapter's `submit` builds the body with `prepareProviderRequest` and returns the binding-level `adjustments` next to the job reference.
4. Completion arrives by webhook or by polling `getStatus`.

### When is it safe to try another provider?

Every error from `submit()` carries a `submissionOutcome`:

- `"rejected"`: the provider certainly did not start a job (missing key, auth, credits, rate limit, an explicit refusal).
- `"unknown"`: the job may exist and be billed (transport timeout, HTTP 500/502/504, a 2xx without a job id).

`isSafeToFallBack(error)` is true only for refusals, never for ambiguous errors or invalid input. `ProviderRouter.submit` applies this rule for you.

## Offline mock provider

The mock serves every catalog model without keys and at zero cost, which is handy for demos, screenshots and UI work.

```ts
import { createMockProvider, ModelRegistry, ProviderRouter, withMockBindings } from "@reflow/core";
import { SEED_MODELS } from "@reflow/core/catalog/models";

const registry = new ModelRegistry(withMockBindings(SEED_MODELS));
const mock = createMockProvider({
  delayMs: { min: 3_000, max: 8_000 },
  // Optional: return local sample files, e.g. demo videos.
  resolveOutput: (request, index) => (request.outputType === "video" ? { url: `/demo/clip-${request.seed % 4}.mp4`, contentType: "video/mp4" } : undefined),
});
const router = new ProviderRouter([mock]);
```

- Stateless: the job id carries everything, so any server instance can answer a poll.
- A job is queued, then running, then succeeds after the delay (or fails when the prompt contains `[fail]`).
- Images are deterministic SVG data URLs at the requested aspect ratio. Video without a resolver falls back to an image-typed SVG placeholder with a play button.
- Mock bindings are `lastResort`: a configured paid provider always wins unless the request asks for `provider: "mock"`.
- `new MockProvider({ runningPolls })` is the in-memory step mode for host test suites.

## Adding a model

Add a `ModelDefinition` to `src/catalog/models/*.ts` with one binding per provider. New bindings start with `verified: false`. Run:

```sh
pnpm --filter @reflow/core catalog:verify plan   # offline: the bodies that would be sent, per endpoint and mode
pnpm --filter @reflow/core catalog:verify        # diff against fal's OpenAPI documents
FAL_KEY=... pnpm --filter @reflow/core catalog:prices
pnpm --filter @reflow/core test                  # includes catalog-wide invariants
```

Use `pinnedParams`, `supportedParamValues`, `supportedModes`, `fixedDuration` and `ignoredRoles` to describe what a binding cannot do, so routing, estimates and adjustments stay honest. A binding may say `verified: true` once its notes state what it was verified against and when, in the form `verified against <what> (<YYYY-MM-DD>)`.

## Adding a provider

1. An adapter under `src/providers/<id>/` that implements `ProviderAdapter` (tag submit errors with `rejectedSubmit` / `ambiguousSubmit`).
2. The id in `PROVIDER_IDS` (`src/catalog/types.ts`) and an entry in `PROVIDER_INFO` (`src/providers/info.ts`).
3. Bindings in the catalog, tests next to the other adapters, and the database enum migration in the web app.
