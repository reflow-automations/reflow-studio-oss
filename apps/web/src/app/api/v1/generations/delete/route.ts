import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { deleteBodySchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 60;

/**
 * POST /api/v1/generations/delete: delete 1-100 finished generations and the media they produced.
 * Running jobs are skipped (cancel them with DELETE /api/v1/generations/:id first). Spend history stays.
 */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const body = await parseJson(request, deleteBodySchema);
    return ok(await getStudio().deleteGenerations(principal.workspaceId, body.ids));
  } catch (error) {
    return fail(error);
  }
}
