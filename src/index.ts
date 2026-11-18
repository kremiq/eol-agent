import { handleMcp } from "./mcp";
import { TOOL_MAP, TOOLS, ToolError } from "./tools";
import { importDataset } from "./import";
import type { Env } from "./types";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

function withCors(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

const unauthorized = () =>
  Response.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="eol-agent"' } });

// REST: /api/<tool_name>?param=... (GET) alebo POST s JSON telom – rovnaké nástroje ako MCP
async function handleApi(req: Request, env: Env, name: string): Promise<Response> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return Response.json({ error: `unknown endpoint ${name}`, endpoints: TOOLS.map((t) => `/api/${t.name}`) }, { status: 404 });
  let args: Record<string, unknown> = {};
  if (req.method === "POST") args = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  else
    for (const [k, v] of new URL(req.url).searchParams) {
      if (v === "") continue;
      args[k] = (k === "limit" || k === "within_days") && /^\d+$/.test(v) ? Number(v) : v;
    }
  const missing = ((tool.inputSchema.required as string[]) ?? []).filter((k) => !args[k]);
  if (missing.length) return Response.json({ error: `missing: ${missing.join(", ")}` }, { status: 400 });
  try {
    return Response.json(await tool.handler(env, args));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ToolError ? 400 : 500 });
  }
}

function llmsTxt(origin: string): string {
  return `# EoL Agent – Lifecycle & Upgrade Paths

> End-of-Sale / End-of-Support dátumy a upgrade cesty pre sieťové a bezpečnostné zariadenia (Palo Alto Networks, Fortinet, Cisco, Juniper). Určené pre presales a ops AI agentov.

Záznamy s "verified": false nie sú overené voči vendorovi – pri odpovedi to vždy uveď spolu so source_url.

## MCP
- [MCP endpoint](${origin}/mcp): Streamable HTTP, bezstavový, len POST. Nástroje: ${TOOLS.map((t) => t.name).join(", ")}

## REST API (GET s query parametrami alebo POST s JSON)
${TOOLS.map((t) => {
  const props = Object.keys((t.inputSchema.properties as object) ?? {});
  return `- [${t.name}](${origin}/api/${t.name}?${props.map((p) => `${p}=`).join("&")}): ${t.description}`;
}).join("\n")}

## Príklady
- ${origin}/api/check_lifecycle?model=PA-3220
- ${origin}/api/get_upgrade_path?os=PAN-OS&from_version=10.1.9&to_version=11.1&model=PA-3220
- ${origin}/api/list_upcoming_eol?within_days=365&vendor=Fortinet
`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/" || url.pathname === "/llms.txt") {
      return new Response(llmsTxt(url.origin), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    }
    if (url.pathname === "/health") return Response.json({ ok: true });

    if (url.pathname === "/admin/import") {
      if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const t = bearer(req);
      if (!env.ADMIN_TOKEN || !t || !safeEqual(t, env.ADMIN_TOKEN)) return unauthorized();
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return Response.json({ ok: false, errors: ["invalid JSON"] }, { status: 400 });
      const res = await importDataset(env, body as any);
      return Response.json(res, { status: res.ok ? 200 : 400 });
    }

    const isMcp = url.pathname === "/mcp";
    const apiMatch = url.pathname.match(/^\/api\/([a-z_]+)$/);
    if (isMcp || apiMatch) {
      if (env.API_TOKEN) {
        const t = bearer(req);
        if (!t || !safeEqual(t, env.API_TOKEN)) return withCors(unauthorized());
      }
      return withCors(isMcp ? await handleMcp(req, env) : await handleApi(req, env, apiMatch![1]));
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
