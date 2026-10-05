import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { studioStatus } from "@/lib/settings/status";

/** GET /api/v1/status — provider keys (hints only), preference, storage backend and budget. */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    return ok(await studioStatus(principal.workspaceId));
  } catch (error) {
    return fail(error);
  }
}
