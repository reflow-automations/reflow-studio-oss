import { after, type NextRequest } from "next/server";
import { isProviderId } from "@reflow/core";
import { getStudio } from "@/lib/studio";

export const maxDuration = 300;

/**
 * Provider callbacks. We acknowledge immediately and process after the response
 * (copying outputs into storage can take a while); the reconciler is the safety net.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  if (!isProviderId(provider)) return new Response("unknown provider", { status: 404 });
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const generationId = request.nextUrl.searchParams.get("g") ?? undefined;
  const token = request.nextUrl.searchParams.get("t") ?? undefined;

  after(async () => {
    try {
      const result = await getStudio().handleWebhook(provider, { headers, rawBody, url: request.url }, { generationId, token });
      if (!result.ok) console.warn(`[webhook:${provider}] ignored: ${result.reason ?? "unknown"}`);
    } catch (error) {
      console.error(`[webhook:${provider}] failed`, error);
    }
  });
  return Response.json({ received: true });
}
