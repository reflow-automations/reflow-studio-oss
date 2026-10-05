/**
 * Verify catalog bindings against fal.ai's per-endpoint OpenAPI documents and
 * compare unit prices with the fal pricing API.
 *
 *   pnpm --filter @reflow/core catalog:verify             # schema diff (FAL_KEY optional)
 *   pnpm --filter @reflow/core catalog:verify plan        # offline: list the bodies that would be checked
 *   FAL_KEY=... pnpm --filter @reflow/core catalog:prices # price diff
 *
 * The schema check builds one request per input mode a binding serves (text:
 * no media; image: a start frame; first_last: start and end frame; reference:
 * the model's other media roles), resolves the endpoint for that mode and
 * diffs the body we would send against that endpoint's input schema. Modes a
 * binding cannot serve are listed as "not routed" instead of being diffed.
 *
 * Kie publishes no OpenAPI documents: verify Kie bindings with one cheap live
 * request per slug and read the 422 message, then record the date in the
 * binding notes ("verified against <what> (<date>)").
 */
import { FalProvider } from "../src/providers/fal/index";
import { SEED_MODELS } from "../src/catalog/models/index";
import { prepareProviderRequest, resolveEndpointMode } from "../src/catalog/mapping";
import { bindingRejections } from "../src/router/index";
import type { EndpointMode, MediaRole, ModelDefinition, ProviderBinding } from "../src/catalog/types";
import type { NormalizedRequest, ResolvedMedia } from "../src/jobs/types";

interface SchemaObject {
  properties?: Record<string, unknown>;
  required?: string[];
}

interface OpenApiDoc {
  components?: { schemas?: Record<string, SchemaObject> };
  paths?: Record<string, { post?: { requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> } } }>;
}

const MODES: readonly EndpointMode[] = ["text", "image", "first_last", "reference"];

function inputSchema(doc: OpenApiDoc): { properties: Record<string, unknown>; required: string[] } | undefined {
  const schemas = doc.components?.schemas ?? {};
  // Prefer the schema referenced by the POST body; fall back to a schema whose name ends with "Input".
  for (const path of Object.values(doc.paths ?? {})) {
    const ref = path.post?.requestBody?.content?.["application/json"]?.schema?.$ref;
    const name = ref?.split("/").pop();
    const schema = name ? schemas[name] : undefined;
    if (schema) return { properties: schema.properties ?? {}, required: schema.required ?? [] };
  }
  const key = Object.keys(schemas).find((k) => /Input$/i.test(k));
  const schema = key ? schemas[key] : undefined;
  return schema ? { properties: schema.properties ?? {}, required: schema.required ?? [] } : undefined;
}

function sampleMedia(model: ModelDefinition, role: MediaRole): ResolvedMedia {
  const kind = model.medias.find((slot) => slot.role === role)?.kind ?? "image";
  const extension = kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png";
  return { role, kind, url: `https://example.com/${role}.${extension}`, source: role };
}

/** Media for one input mode, or undefined when the model cannot form a request in that mode. */
function mediasFor(model: ModelDefinition, mode: EndpointMode): ResolvedMedia[] | undefined {
  const roles = new Set(model.medias.map((slot) => slot.role));
  const required = model.medias.filter((slot) => slot.required).map((slot) => slot.role);
  let picked: MediaRole[];
  switch (mode) {
    case "text":
      picked = [];
      break;
    case "image":
      if (!roles.has("start_image")) return undefined;
      picked = ["start_image"];
      break;
    case "first_last":
      if (!roles.has("start_image") || !roles.has("end_image")) return undefined;
      picked = ["start_image", "end_image"];
      break;
    default:
      picked = [...roles].filter((role) => role !== "start_image" && role !== "end_image");
      if (picked.length === 0) return undefined;
  }
  for (const role of required) if (!picked.includes(role)) picked.push(role);
  const medias = picked.map((role) => sampleMedia(model, role));
  // Required media can move a request into another mode; only keep requests that really are `mode`.
  return resolveEndpointMode(medias) === mode ? medias : undefined;
}

function sampleRequest(model: ModelDefinition, medias: ResolvedMedia[]): NormalizedRequest {
  const params: Record<string, unknown> = {};
  for (const p of model.parameters) params[p.name] = p.default ?? p.options?.[0] ?? (p.type === "boolean" ? true : p.type === "string" ? "x" : 1);
  return {
    model: model.id,
    prompt: "sample prompt",
    negative_prompt: "blurry",
    aspect_ratio: model.aspect_ratios[0],
    duration: model.default_duration ?? model.durations?.[0] ?? model.duration_range?.min,
    count: Math.min(2, model.max_count ?? 4),
    medias: medias.map((m) => ({ role: m.role, value: m.source })),
    params,
    adjustments: [],
  };
}

async function verifySchemas(fal: FalProvider, planOnly: boolean): Promise<number> {
  const docs = new Map<string, Promise<OpenApiDoc | undefined>>();
  const fetchDoc = (endpoint: string) => {
    let doc = docs.get(endpoint);
    if (!doc) {
      doc = fal.fetchOpenApi(endpoint).then((value) => value as OpenApiDoc | undefined);
      docs.set(endpoint, doc);
    }
    return doc;
  };
  let problems = 0;
  for (const model of SEED_MODELS) {
    for (const binding of model.bindings.filter((b) => b.provider === "fal")) {
      for (const mode of MODES) {
        const medias = mediasFor(model, mode);
        if (!medias) continue;
        const request = sampleRequest(model, medias);
        const blocked = bindingRejections(binding, request);
        if (blocked.length > 0) {
          console.log(`- ${model.id} [${mode}] not routed to ${binding.endpoint}: ${blocked.join("; ")}`);
          continue;
        }
        const { endpoint, body, adjustments } = prepareProviderRequest({ model, binding, request, medias });
        if (planOnly) {
          const notes = adjustments.length ? ` (adjusted: ${adjustments.map((a) => a.field).join(", ")})` : "";
          console.log(`  ${model.id} [${mode}] -> ${endpoint}: ${Object.keys(body).join(", ")}${notes}`);
          continue;
        }
        problems += await diffEndpoint(model, mode, endpoint, body, fetchDoc);
      }
    }
  }
  return problems;
}

async function diffEndpoint(
  model: ModelDefinition,
  mode: EndpointMode,
  endpoint: string,
  body: Record<string, unknown>,
  fetchDoc: (endpoint: string) => Promise<OpenApiDoc | undefined>,
): Promise<number> {
  const label = `${model.id} [${mode}] -> ${endpoint}`;
  let doc: OpenApiDoc | undefined;
  try {
    doc = await fetchDoc(endpoint);
  } catch (error) {
    console.log(`x ${label}: could not fetch OpenAPI (${(error as Error).message})`);
    return 1;
  }
  const schema = doc ? inputSchema(doc) : undefined;
  if (!schema) {
    console.log(`? ${label}: no input schema found in OpenAPI`);
    return 1;
  }
  const unknown = Object.keys(body).filter((k) => !(k in schema.properties));
  const missingRequired = schema.required.filter((k) => !(k in body));
  if (unknown.length === 0 && missingRequired.length === 0) {
    console.log(`ok ${label}`);
    return 0;
  }
  console.log(`x ${label}`);
  if (unknown.length) console.log(`    fields we send that the endpoint does not declare: ${unknown.join(", ")}`);
  if (missingRequired.length) console.log(`    required fields we never send: ${missingRequired.join(", ")}`);
  console.log(`    endpoint accepts: ${Object.keys(schema.properties).join(", ")}`);
  return 1;
}

function falEndpoints(binding: ProviderBinding): string[] {
  return [...new Set([binding.endpoint, ...Object.values(binding.endpointByMode ?? {}).filter((value): value is string => Boolean(value))])];
}

/** Rough unit comparison between fal's pricing API and the catalog's `PricingUnit`. */
function unitsMatch(live: string, ours: string): boolean {
  const norm = live.toLowerCase().replace(/s$/, "");
  if (norm === ours) return true;
  if (ours === "generation") return ["request", "video", "call", "generation", "unit"].includes(norm);
  if (ours === "megapixel") return norm === "mp" || norm === "megapixel";
  return false;
}

async function syncPrices(fal: FalProvider): Promise<void> {
  const ids = [...new Set(SEED_MODELS.flatMap((m) => m.bindings.filter((b) => b.provider === "fal").flatMap(falEndpoints)))];
  const prices = await fal.fetchPricing(ids);
  const byId = new Map(prices.map((p) => [p.endpoint_id, p] as const));
  for (const model of SEED_MODELS) {
    for (const binding of model.bindings.filter((b) => b.provider === "fal")) {
      const ours = binding.pricing;
      for (const endpoint of falEndpoints(binding)) {
        const live = byId.get(endpoint);
        if (!live) {
          console.log(`? ${model.id} -> ${endpoint}: no price returned`);
          continue;
        }
        if (!ours) {
          console.log(`x ${model.id} -> ${endpoint}: live ${live.unit_price} ${live.currency}/${live.unit} | catalog: none`);
          continue;
        }
        const samePrice = Math.abs(ours.usd - live.unit_price) < 1e-6 || (ours.first_unit_usd !== undefined && Math.abs(ours.first_unit_usd - live.unit_price) < 1e-6);
        const sameUnit = unitsMatch(live.unit, ours.unit);
        const flag = samePrice && sameUnit ? "ok" : "x";
        const modifiers = ours.modifiers?.length ? ` (+${ours.modifiers.length} modifier(s) not compared)` : "";
        console.log(`${flag} ${model.id} -> ${endpoint}: live ${live.unit_price} ${live.currency}/${live.unit} | catalog ${ours.usd}/${ours.unit}${modifiers}${sameUnit ? "" : " | UNIT MISMATCH"}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "verify";
  const planOnly = process.argv.slice(2).includes("plan");
  const fal = new FalProvider();
  if (mode === "prices") {
    if (!fal.isConfigured()) {
      console.error("FAL_KEY is required for catalog:prices");
      process.exit(2);
    }
    await syncPrices(fal);
    return;
  }
  const problems = await verifySchemas(fal, planOnly);
  if (planOnly) return;
  console.log(problems === 0 ? "\nAll fal bindings match their OpenAPI input schemas." : `\n${problems} endpoint/mode pair(s) need attention.`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
