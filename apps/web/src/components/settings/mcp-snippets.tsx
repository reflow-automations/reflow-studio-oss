import { CopyButton } from "@/components/ui/copy-button";

interface McpSnippetsProps {
  origin: string;
  apiKey?: string;
}

function Snippet({ title, code, hint }: { title: string; code: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        <CopyButton value={code} size="xs" />
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">{code}</pre>
      {hint ? <p className="text-[11px] text-subtle">{hint}</p> : null}
    </div>
  );
}

/** Ready-to-copy snippets for Claude Code, Cursor and curl. Pure component: usable from server and client trees. */
export function McpSnippets({ origin, apiKey = "<your-api-key>" }: McpSnippetsProps) {
  const mcpUrl = `${origin}/api/mcp`;
  const claude = `claude mcp add --transport http reflow-studio ${mcpUrl} --header "Authorization: Bearer ${apiKey}"`;
  const cursor = JSON.stringify({ mcpServers: { "reflow-studio": { url: mcpUrl, headers: { Authorization: `Bearer ${apiKey}` } } } }, null, 2);
  const curl = [`curl -sS ${origin}/api/v1/generations \\`, `  -H "Authorization: Bearer ${apiKey}" \\`, `  -H "Content-Type: application/json" \\`, `  -d '{"model":"nano_banana_2","prompt":"a studio portrait of a fox, soft light","aspect_ratio":"1:1","count":1}'`].join("\n");
  return (
    <div className="flex flex-col gap-4">
      <Snippet title="Claude Code" code={claude} hint="Adds the studio as an HTTP MCP server for the current project." />
      <Snippet title="Cursor (~/.cursor/mcp.json)" code={cursor} hint="Merge into your existing mcpServers block." />
      <Snippet title="REST (curl)" code={curl} hint={`Poll with GET ${origin}/api/v1/generations/<id> or long-poll POST ${origin}/api/v1/generations/wait.`} />
    </div>
  );
}
