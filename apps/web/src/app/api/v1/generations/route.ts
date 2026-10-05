import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createGenerationBodySchema, listGenerationsQuerySchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 60;

/** POST /api/v1/generations — submit a generation (Higgsfield generate_image / generate_video equivalent). */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const body = await parseJson(request, createGenerationBodySchema);
    const { provider, idempotency_key, folder_id, get_cost, ...generateRequest } = body;
    const studio = getStudio();
    if (get_cost) return ok(await studio.estimate(principal.workspaceId, generateRequest, provider));
    const generation = await studio.createGeneration({
      request: generateRequest,
      principal: { workspaceId: principal.workspaceId, userId: principal.userId, apiKeyId: principal.apiKeyId },
      provider,
      idempotencyKey: idempotency_key,
      folderId: folder_id,
      allowUrls: true,
    });
    return ok(generation, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

/** GET /api/v1/generations?limit=24&before=<iso>&state=succeeded&type=image */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    const query = listGenerationsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const result = await getStudio().listGenerations(principal.workspaceId, { limit: query.limit, before: query.before, state: query.state, type: query.type, batchId: query.batch_id });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
