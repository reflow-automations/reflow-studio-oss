import type { NextRequest } from "next/server";
import { toPublicModel } from "@reflow/core";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/models/[id]">) {
  try {
    await requirePrincipal(request, "read");
    const { id } = await ctx.params;
    return ok(toPublicModel(getStudio().models.require(id)));
  } catch (error) {
    return fail(error);
  }
}
