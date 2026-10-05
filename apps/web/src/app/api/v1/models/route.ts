import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";
import type { Capability, OutputType, ProviderId } from "@reflow/core";

/** GET /api/v1/models?type=image&capability=text-to-image&q=kling&provider=fal */
export async function GET(request: NextRequest) {
  try {
    await requirePrincipal(request, "read");
    const p = request.nextUrl.searchParams;
    const result = getStudio().models.list({
      type: (p.get("type") as OutputType | null) ?? undefined,
      capability: (p.get("capability") as Capability | null) ?? undefined,
      provider: (p.get("provider") as ProviderId | null) ?? undefined,
      q: p.get("q") ?? undefined,
      includeDeprecated: p.get("include_deprecated") === "true",
      limit: p.get("limit") && Number.isFinite(Number(p.get("limit"))) ? Number(p.get("limit")) : undefined,
      offset: p.get("offset") && Number.isFinite(Number(p.get("offset"))) ? Number(p.get("offset")) : undefined,
    });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
