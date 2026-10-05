import type { NextRequest } from "next/server";
import { timingSafeEqual, utf8 } from "@reflow/core";
import { env } from "@/lib/env";
import { getStudio } from "@/lib/studio";

export const maxDuration = 120;

/** POST /api/internal/reconcile — poll providers for unfinished generations (called by pg_cron / a scheduler). */
export async function POST(request: NextRequest) {
  const e = env();
  const secret = e.RECONCILE_SECRET ?? e.WEBHOOK_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(utf8(auth), utf8(`Bearer ${secret}`))) return new Response("unauthorized", { status: 401 });
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  const result = await getStudio().reconcile({ limit: Number.isFinite(limit) ? limit : 25 });
  return Response.json(result);
}

export const GET = POST;
