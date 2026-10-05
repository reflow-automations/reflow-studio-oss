import type { NextRequest } from "next/server";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { importMediaSchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

export const maxDuration = 120;

/** POST /api/v1/media/import — copy an https URL into storage (Higgsfield media_import_url). */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const body = await parseJson(request, importMediaSchema);
    const studio = getStudio();
    const asset = await studio.importMediaUrl(principal, body.url, body.type);
    return ok({ asset_id: asset.id, kind: asset.kind, status: asset.status, content_type: asset.content_type, url: await studio.assetUrl(asset) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
