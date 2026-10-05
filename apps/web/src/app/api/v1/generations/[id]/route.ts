import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 60;

/** GET /api/v1/generations/:id — refreshes from the provider when still running (poll-on-read). */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/generations/[id]">) {
  try {
    const principal = await requirePrincipal(request, "read");
    const { id } = await ctx.params;
    const refresh = request.nextUrl.searchParams.get("refresh") !== "false";
    return ok(await getStudio().getGeneration(id, { workspaceId: principal.workspaceId, refresh }));
  } catch (error) {
    return fail(error);
  }
}

/** DELETE /api/v1/generations/:id — cancel a running generation. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/v1/generations/[id]">) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const { id } = await ctx.params;
    return ok(await getStudio().cancelGeneration(id, principal.workspaceId));
  } catch (error) {
    return fail(error);
  }
}
