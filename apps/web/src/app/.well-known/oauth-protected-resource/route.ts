import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";
import { appBaseUrl } from "@/lib/env";

/**
 * RFC 9728 Protected Resource Metadata. Today the MCP endpoint accepts
 * workspace API keys; when Supabase's OAuth 2.1 server is enabled, list its
 * issuer here (https://<ref>.supabase.co/auth/v1) so OAuth-capable clients can
 * discover it.
 */
const issuers = (process.env.MCP_OAUTH_ISSUERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const handler = protectedResourceHandler({ authServerUrls: issuers, resourceUrl: `${appBaseUrl()}/api/mcp` });
const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
