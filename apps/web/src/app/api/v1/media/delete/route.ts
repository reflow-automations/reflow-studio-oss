import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { deleteBodySchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 60;

/** POST /api/v1/media/delete: delete 1-100 assets and their storage objects. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const body = await parseJson(request, deleteBodySchema);
    return ok(await getStudio().deleteMedia(principal.workspaceId, body.ids));
  } catch (error) {
    return fail(error);
  }
}
