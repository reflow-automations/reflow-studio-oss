import type { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/respond";
import { requirePrincipal } from "@/lib/auth/principal";
import { getStudio } from "@/lib/studio";

/** GET /api/v1/balance — ledger totals plus provider balances (Higgsfield balance). */
export async function GET(request: NextRequest) {
  try {
    const principal = await requirePrincipal(request, "read");
    return ok(await getStudio().balance(principal.workspaceId));
  } catch (error) {
    return fail(error);
  }
}
