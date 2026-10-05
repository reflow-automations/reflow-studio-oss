import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createGenerationBodySchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

/** POST /api/v1/estimate — cost preflight without submitting (Higgsfield get_cost:true). */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    const body = await parseJson(request, createGenerationBodySchema);
    const { model, prompt, negative_prompt, aspect_ratio, duration, count, medias, params } = body;
    return ok(await getStudio().estimate(principal.workspaceId, { model, prompt, negative_prompt, aspect_ratio, duration, count, medias, params }, body.provider));
  } catch (error) {
    return fail(error);
  }
}
