import type { NextRequest } from "next/server";
import type { MediaKind } from "@reflow/core";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { uploadTargetSchema } from "@/lib/api/schemas";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

/** GET /api/v1/media?type=image&q=fox&model=… — list ready assets (newest first) with URLs; `q` searches prompt/title. */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    const p = request.nextUrl.searchParams;
    const result = await getStudio().listMedia(principal.workspaceId, {
      kind: (p.get("type") as MediaKind | null) ?? undefined,
      limit: Number.isFinite(Number(p.get("limit"))) && p.get("limit") ? Number(p.get("limit")) : undefined,
      before: p.get("before") ?? undefined,
      q: p.get("q") ?? undefined,
      modelId: p.get("model") ?? undefined,
    });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}

/** POST /api/v1/media — create a signed upload target (Higgsfield media_upload); PUT the bytes, then confirm. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "generate");
    const body = await parseJson(request, uploadTargetSchema);
    const target = await getStudio().createUploadTarget(principal, { filename: body.filename, contentType: body.content_type });
    return ok({ ...target, confirm_url: `/api/v1/media/${target.asset_id}/confirm` }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
