import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { isStudioError, PROVIDER_IDS, type Capability, type OutputType, type ProviderId } from "@reflow/core";
import { z } from "zod";
import { generateRequestSchema, mediaInputSchema } from "@/lib/api/schemas";
import type { ApiScope } from "@/lib/auth/api-keys";
import { requireScope } from "@/lib/auth/principal";
import { PROVIDER_PREFERENCES, setProviderPreference, type ProviderPreference } from "@/lib/settings/provider-keys";
import { studioStatus } from "@/lib/settings/status";
import { getStudio, type Principal } from "@/lib/studio";

/** Auth context threaded through mcp-handler's `ctx.http.authInfo.extra`. */
export interface McpPrincipalExtra extends Principal {
  scopes: string[];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

type McpCtx = { http?: { authInfo?: { scopes?: string[]; extra?: Partial<McpPrincipalExtra> } } } | undefined;

/** Throws a 403 StudioError unless the caller's API key carries `scope` ('admin' grants all). */
function checkScope(ctx: unknown, scope: ApiScope): void {
  const authInfo = (ctx as McpCtx)?.http?.authInfo;
  requireScope(authInfo?.extra?.scopes ?? authInfo?.scopes ?? [], scope);
}

/** Authenticated principal for a tool call, after checking the tool's scope. */
function principalFrom(ctx: unknown, scope: ApiScope): Principal {
  const extra = (ctx as McpCtx)?.http?.authInfo?.extra;
  if (!extra?.workspaceId || !extra.userId) throw new Error("unauthenticated");
  checkScope(ctx, scope);
  return { workspaceId: extra.workspaceId, userId: extra.userId, apiKeyId: extra.apiKeyId };
}

function result(data: unknown, summary?: string): ToolResult {
  const text = summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }], structuredContent: typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : { data } };
}

function errorResult(error: unknown): ToolResult {
  const payload = isStudioError(error) ? error.toJSON() : { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text", text: `Error: ${payload.message}\n${JSON.stringify(payload, null, 2)}` }], structuredContent: { error: payload }, isError: true };
}

async function run(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResult(error);
  }
}

export const MCP_INSTRUCTIONS = `Reflow Studio: generate images and videos through fal.ai, Kie.ai, and the separate Higgsfield API with a Higgsfield-style workflow.
Typical flow: models_explore (find a model id and its parameters/media roles) → optionally get_cost → generate_image / generate_video (returns a generation id immediately) → jobs_wait with the ids (long-polls up to 20 s; call again while all_terminal is false) → use the returned URLs. Give users a direct clickable output link; do not assume an external Markdown image embed renders in every MCP client.
Reference media: pass asset ids from media_import_url / media_upload+media_confirm, or previous generation ids, in medias[{role,value}] — roles come from the model definition. Fal/Kie costs are catalog estimates. Higgsfield uses a numeric account quote when available, otherwise a labeled public estimate; temporary cashback is excluded. Adjustments in responses tell you which parameters were clamped.
Provider API keys are configured in the web app (Settings → Providers) or environment variables; studio_status shows which providers are usable, the routing preference (cheapest | fal | kie | higgsfield, changeable with set_provider_preference), the storage backend (Cloudflare R2 or Supabase) and this month's spend. Higgsfield API billing is separate from Higgsfield plan credits. If a provider is missing or invalid, tell the user to add the key in Settings → Providers — never ask for keys in chat.`;

const generateShape = {
  model: z.string().describe("Model id from models_explore."),
  prompt: z.string().optional(),
  negative_prompt: z.string().optional(),
  aspect_ratio: z.string().optional().describe('e.g. "16:9", "9:16", "1:1"; clamped to what the model supports'),
  count: z.number().int().min(1).max(4).optional().describe("Variants (1-4)."),
  medias: z.array(mediaInputSchema).optional().describe("Reference media: asset ids, generation ids (never raw URLs)."),
  params: z.record(z.string(), z.unknown()).optional().describe("Model-specific parameters from models_explore → parameters."),
  provider: z.enum(PROVIDER_IDS).optional().describe("Force a provider; default: the routing preference from studio_status (cheapest | fal | kie | higgsfield) with other valid providers as fallback."),
  get_cost: z.boolean().optional().describe("If true, only return the cost estimate; submit nothing."),
};

/** Registers all tools on an McpServer. Shared by the HTTP route (and a future stdio server). */
export function registerStudioTools(server: McpServer): void {
  const studio = getStudio();

  server.registerTool(
    "models_explore",
    {
      title: "Explore models",
      description: "List, search or inspect generation models (id, vendor, capabilities, parameters, media roles, aspect ratios, durations, per-provider pricing). Use action 'get' with model_id for the full definition.",
      inputSchema: z.object({
        action: z.enum(["list", "search", "get"]).default("list"),
        type: z.enum(["image", "video", "audio", "3d"]).optional(),
        capability: z.string().optional().describe("e.g. text-to-image, image-to-video, reference-to-video, upscale-image"),
        provider: z.enum(PROVIDER_IDS).optional(),
        query: z.string().optional().describe("Free-text search over name, vendor, tags and Higgsfield ids."),
        model_id: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, ctx) =>
      run(() => {
        checkScope(ctx, "read");
        if (args.action === "get") {
          if (!args.model_id) throw new Error("model_id is required for action=get");
          const model = studio.models.require(args.model_id);
          const { bindings, ...rest } = model;
          return result({ ...rest, providers: bindings.map((b) => ({ provider: b.provider, endpoint: b.endpoint, pricing: b.pricing, verified: b.verified, notes: b.notes })) });
        }
        const list = studio.models.list({ type: args.type as OutputType | undefined, capability: args.capability as Capability | undefined, provider: args.provider as ProviderId | undefined, q: args.query, limit: args.limit ?? 50 });
        const compact = list.items.map((m) => ({
          id: m.id,
          name: m.name,
          vendor: m.vendor,
          output_type: m.output_type,
          capabilities: m.capabilities,
          aspect_ratios: m.aspect_ratios,
          durations: m.durations ?? m.duration_range,
          media_roles: m.medias.map((s) => `${s.role}${s.required ? "*" : ""}${s.max && s.max > 1 ? ` (max ${s.max})` : ""}`),
          parameters: m.parameters.map((p) => `${p.name}${p.options ? `=${p.options.join("|")}` : `:${p.type}`}${p.default !== undefined ? ` (default ${String(p.default)})` : ""}`),
          providers: m.providers.map((p) => `${p.provider}:${p.endpoint}${p.pricing ? ` $${p.pricing.usd}/${p.pricing.unit}` : ""}`),
          replaces_higgsfield: m.higgsfield_ids,
        }));
        return result({ total: list.total, items: compact }, `${list.total} model(s)`);
      }),
  );

  const generate = (outputType: "image" | "video") => async (args: z.infer<z.ZodObject<typeof generateShape>> & { duration?: number }, ctx: unknown) =>
    run(async () => {
      const { provider, get_cost, ...request } = args;
      const principal = principalFrom(ctx, get_cost ? "read" : "generate");
      const model = studio.models.require(request.model);
      if (model.output_type !== outputType) throw new Error(`${request.model} is a ${model.output_type} model; use generate_${model.output_type === "video" ? "video" : "image"}`);
      const parsed = generateRequestSchema.parse(request);
      if (get_cost) {
        const estimate = await studio.estimate(principal.workspaceId, parsed, provider);
        return result(estimate, `Cost estimate for ${parsed.model}`);
      }
      const generation = await studio.createGeneration({ request: parsed, principal, provider, allowUrls: false });
      return result(
        { id: generation.id, state: generation.state, provider: generation.provider, cost_estimate_usd: generation.cost_estimate_usd, adjustments: generation.adjustments },
        `Submitted ${outputType} generation ${generation.id} (${generation.state}). Call jobs_wait with this id.`,
      );
    });

  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description: "Submit an image generation/edit job. Returns a generation id; poll with jobs_wait. Pass reference images via medias with the roles listed by models_explore.",
      inputSchema: z.object(generateShape),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    generate("image"),
  );

  server.registerTool(
    "generate_video",
    {
      title: "Generate video",
      description: "Submit a text-to-video / image-to-video / reference-to-video job. Returns a generation id; poll with jobs_wait (video takes 1-10 minutes).",
      inputSchema: z.object({ ...generateShape, duration: z.number().min(1).max(60).optional().describe("Seconds; clamped to the model's supported range.") }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    generate("video"),
  );

  server.registerTool(
    "jobs_wait",
    {
      title: "Wait for generations",
      description: "Long-poll 1-12 generation ids for up to 20 seconds. Returns each generation's state, outputs (signed URLs) and cost. When all_terminal is false, call again.",
      inputSchema: z.object({ ids: z.array(z.string().uuid()).min(1).max(12), timeout_seconds: z.number().int().min(0).max(20).default(15) }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        const res = await studio.waitForGenerations(args.ids, { workspaceId: principal.workspaceId, timeoutMs: args.timeout_seconds * 1000 });
        const items = res.items.map((g) => ({ id: g.id, state: g.state, progress: g.progress, error: g.error, cost_estimate_usd: g.cost_estimate_usd, cost_actual_usd: g.cost_actual_usd, outputs: g.outputs.map((o) => ({ index: o.index, kind: o.kind, url: o.url, width: o.width, height: o.height, duration_seconds: o.duration_seconds })) }));
        const links = items.flatMap((item) => item.outputs.filter((output) => output.url).map((output) => `${item.id} output ${output.index}: ${output.url}`));
        const summary = res.all_terminal ? `All generations finished.${links.length ? `\nDirect media links:\n${links.join("\n")}` : ""}` : "Still running; call jobs_wait again.";
        return result({ all_terminal: res.all_terminal, poll_after_seconds: res.all_terminal ? undefined : 5, items }, summary);
      }),
  );

  server.registerTool(
    "show_generations",
    {
      title: "List generations",
      description: "Browse generation history (newest first) with outputs and costs.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(12),
        before: z.string().optional().describe("Cursor (next_cursor from a previous call)."),
        type: z.enum(["image", "video", "audio", "3d"]).optional(),
        state: z.enum(["pending", "queued", "running", "succeeded", "failed", "cancelled"]).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        const res = await studio.listGenerations(principal.workspaceId, { limit: args.limit, before: args.before, type: args.type, state: args.state });
        return result({
          next_cursor: res.next_cursor,
          items: res.items.map((g) => ({ id: g.id, model_id: g.model_id, state: g.state, created_at: g.created_at, cost_estimate_usd: g.cost_estimate_usd, cost_actual_usd: g.cost_actual_usd, prompt: (g.request as { prompt?: string }).prompt, outputs: g.outputs.map((o) => ({ kind: o.kind, url: o.url })) })),
        });
      }),
  );

  server.registerTool(
    "get_generation",
    {
      title: "Get generation",
      description: "Full details of one generation (request, adjustments, provider, outputs, cost, error).",
      inputSchema: z.object({ id: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        return result(await studio.getGeneration(args.id, { workspaceId: principal.workspaceId, refresh: true }));
      }),
  );

  server.registerTool(
    "cancel_generation",
    {
      title: "Cancel generation",
      description: "Cancel a queued/running generation (best effort at the provider).",
      inputSchema: z.object({ id: z.string().uuid() }),
      annotations: { destructiveHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "generate");
        return result(await studio.cancelGeneration(args.id, principal.workspaceId));
      }),
  );

  server.registerTool(
    "media_import_url",
    {
      title: "Import media from URL",
      description: "Copy an https image/video/audio URL into the studio and return an asset id to use in medias[].value.",
      inputSchema: z.object({ url: z.string().url(), type: z.enum(["image", "video", "audio"]).optional() }),
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "generate");
        const asset = await studio.importMediaUrl(principal, args.url, args.type);
        return result({ asset_id: asset.id, kind: asset.kind, status: asset.status, content_type: asset.content_type }, `Imported as asset ${asset.id}`);
      }),
  );

  server.registerTool(
    "media_upload",
    {
      title: "Create upload target",
      description: "Get a presigned PUT URL for uploading a local file (image/video/audio). PUT the bytes with the returned content-type header, then call media_confirm with the asset_id.",
      inputSchema: z.object({ filename: z.string(), content_type: z.string() }),
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "generate");
        const target = await studio.createUploadTarget(principal, { filename: args.filename, contentType: args.content_type });
        return result({ ...target, curl: `curl -X PUT -H 'content-type: ${args.content_type}' --upload-file '${args.filename}' '${target.upload_url}'` });
      }),
  );

  server.registerTool(
    "media_confirm",
    {
      title: "Confirm upload",
      description: "Mark an uploaded asset as ready after the PUT succeeded.",
      inputSchema: z.object({ asset_id: z.string().uuid() }),
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "generate");
        const asset = await studio.confirmUpload(principal, args.asset_id);
        return result({ asset_id: asset.id, kind: asset.kind, status: asset.status, bytes: asset.bytes });
      }),
  );

  server.registerTool(
    "show_medias",
    {
      title: "List media assets",
      description: "List uploaded/imported/generated assets with URLs (newest first). This is the studio's memory: `q` searches the prompt/title of past outputs, `model` filters by model id.",
      inputSchema: z.object({ type: z.enum(["image", "video", "audio"]).optional(), q: z.string().optional().describe("Search words matched against the prompt/title."), model: z.string().optional().describe("Model id from models_explore."), limit: z.number().int().min(1).max(50).default(12), before: z.string().optional() }),
      annotations: { readOnlyHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        const res = await studio.listMedia(principal.workspaceId, { kind: args.type, limit: args.limit, before: args.before, q: args.q, modelId: args.model });
        return result({ next_cursor: res.next_cursor, items: res.items.map((a) => ({ asset_id: a.id, kind: a.kind, origin: a.origin, model_id: a.model_id, prompt: a.prompt, title: a.title, content_type: a.content_type, width: a.width, height: a.height, url: a.url, created_at: a.created_at })) });
      }),
  );

  server.registerTool(
    "studio_status",
    {
      title: "Studio status",
      description: "Configuration overview: which provider keys are set (hints only, never secrets) and whether they tested valid, the routing preference, the storage backend (R2/Supabase), encryption setup and this month's spend versus the budget cap.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        const status = await studioStatus(principal.workspaceId);
        const usable = status.providers.filter((p) => p.source !== "none" && p.status !== "invalid").map((p) => p.provider);
        return result(status, usable.length ? `Usable providers: ${usable.join(", ")}. Preference: ${status.provider_preference}. Storage: ${status.storage.kind}.` : "No provider keys configured yet — add them in Settings → Providers.");
      }),
  );

  server.registerTool(
    "set_provider_preference",
    {
      title: "Set provider preference",
      description: "Choose routing: cheapest compares estimated request totals across configured providers; fal, kie or higgsfield prefers that provider first with valid fallbacks.",
      inputSchema: z.object({ preference: z.enum(PROVIDER_PREFERENCES as [ProviderPreference, ...ProviderPreference[]]) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "generate");
        await setProviderPreference(principal.workspaceId, args.preference);
        return result({ provider_preference: args.preference }, `Routing preference set to ${args.preference}.`);
      }),
  );

  server.registerTool(
    "balance",
    {
      title: "Balance and spend",
      description: "Spend so far (USD ledger), reserved amounts and provider balances where available (Kie credits).",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async (_args, ctx) =>
      run(async () => {
        const principal = principalFrom(ctx, "read");
        return result(await studio.balance(principal.workspaceId));
      }),
  );
}
