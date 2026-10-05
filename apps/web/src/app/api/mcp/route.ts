import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiKey } from "@/lib/auth/api-keys";
import { appBaseUrl } from "@/lib/env";
import { MCP_INSTRUCTIONS, registerStudioTools } from "@/lib/mcp/server";

export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    registerStudioTools(server);
  },
  {
    serverInfo: { name: "reflow-studio", version: "0.1.0" },
    instructions: MCP_INSTRUCTIONS,
    maxSubscriptions: 0,
  },
);

/** Bearer API keys (rfl_...) issued in Settings → API keys. */
const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  const principal = await verifyApiKey(bearerToken);
  if (!principal) return undefined;
  return {
    token: bearerToken ?? "",
    clientId: principal.apiKeyId,
    scopes: principal.scopes,
    extra: { workspaceId: principal.workspaceId, userId: principal.userId, apiKeyId: principal.apiKeyId, scopes: principal.scopes },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
  resourceUrl: `${appBaseUrl()}/api/mcp`,
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
