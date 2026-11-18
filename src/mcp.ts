// Minimalistický, bezstavový MCP server (Streamable HTTP transport, JSON odpovede).
// Bez Durable Objects – každý POST /mcp je samostatný JSON-RPC request (alebo batch).
import { TOOLS, TOOL_MAP, ToolError } from "./tools";
import type { Env } from "./types";

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "eol-agent", title: "Lifecycle & Upgrade Paths", version: "0.1.0" };
const INSTRUCTIONS =
  "Databáza End-of-Sale/End-of-Support dátumov a upgrade ciest pre sieťové a bezpečnostné zariadenia " +
  "(Palo Alto Networks, Fortinet, Cisco, Juniper). Záznamy s verified=false nie sú overené – vždy to " +
  "pri odpovedi používateľovi spomeň a uveď source_url.";

type RpcReq = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };
type RpcRes = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } };

const ok = (id: RpcReq["id"], result: unknown): RpcRes => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: RpcReq["id"], code: number, message: string): RpcRes => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleOne(env: Env, req: RpcReq): Promise<RpcRes | null> {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") return err(req?.id, -32600, "Invalid Request");
  const isNotification = req.id === undefined;

  switch (req.method) {
    case "initialize": {
      const requested = req.params?.protocolVersion;
      return ok(req.id, {
        protocolVersion: SUPPORTED.includes(requested) ? requested : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
          name, title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = TOOL_MAP.get(req.params?.name);
      if (!tool) return err(req.id, -32602, `Unknown tool: ${req.params?.name}`);
      const args = req.params?.arguments ?? {};
      const missing = ((tool.inputSchema.required as string[]) ?? []).filter((k) => args[k] === undefined || args[k] === "");
      if (missing.length) {
        return ok(req.id, { isError: true, content: [{ type: "text", text: `Chýbajú povinné parametre: ${missing.join(", ")}` }] });
      }
      try {
        const result = await tool.handler(env, args);
        return ok(req.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (e) {
        const msg = e instanceof ToolError ? e.message : `Interná chyba: ${(e as Error).message}`;
        return ok(req.id, { isError: true, content: [{ type: "text", text: msg }] });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, ...
      return err(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    // bezstavový server – žiadny SSE stream ani session
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  }

  const batch = Array.isArray(body);
  const reqs = (batch ? body : [body]) as RpcReq[];
  const results = (await Promise.all(reqs.map((r) => handleOne(env, r)))).filter((r): r is RpcRes => r !== null);

  if (!results.length) return new Response(null, { status: 202 });
  return Response.json(batch ? results : results[0]);
}
