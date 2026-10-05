import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { waitBodySchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 60;

/** POST /api/v1/generations/wait — long-poll up to 25 s for 1-12 generations (Higgsfield jobs_wait). */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    const body = await parseJson(request, waitBodySchema);
    const result = await getStudio().waitForGenerations(body.ids, { workspaceId: principal.workspaceId, timeoutMs: (body.timeout_seconds ?? 15) * 1000 });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
