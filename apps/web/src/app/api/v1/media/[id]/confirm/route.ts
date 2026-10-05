import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

/** POST /api/v1/media/:id/confirm — mark an upload ready (Higgsfield media_confirm). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/media/[id]/confirm">) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const { id } = await ctx.params;
    const studio = getStudio();
    const asset = await studio.confirmUpload(principal, id);
    return ok({ asset_id: asset.id, kind: asset.kind, status: asset.status, bytes: asset.bytes, url: await studio.assetUrl(asset) });
  } catch (error) {
    return fail(error);
  }
}
