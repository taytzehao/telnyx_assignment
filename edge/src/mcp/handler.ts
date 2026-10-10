import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "../env";
import { createMcpServer } from "./server";
import { log, generateRequestId } from "../lib/logger";

const sessions = new Map<string, McpServerWithTransport>();

interface McpServerWithTransport {
  server: ReturnType<typeof createMcpServer>;
  transport: WebStandardStreamableHTTPServerTransport;
}

export async function handleMcpRequest(req: Request, env: Env): Promise<Response> {
  const requestId = generateRequestId();
  const start = Date.now();

  const sessionId = req.headers.get("mcp-session-id") ?? undefined;

  try {
    if (req.method === "DELETE" && sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        await session.server.close();
        await session.transport.close();
        sessions.delete(sessionId);
      }
      log({
        requestId,
        caller: "mcp",
        node: "mcp",
        outcome: "success",
        latencyMs: Date.now() - start,
        method: "DELETE",
        sessionId: sessionId ?? "",
      });
      return new Response(null, { status: 204 });
    }

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      const res = await session.transport.handleRequest(req);
      log({
        requestId,
        caller: "mcp",
        node: "mcp",
        outcome: "success",
        latencyMs: Date.now() - start,
        method: req.method,
        sessionId,
      });
      return res;
    }

    const newSessionId = crypto.randomUUID();
    const server = createMcpServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    const res = await transport.handleRequest(req);

    sessions.set(newSessionId, { server, transport });

    log({
      requestId,
      caller: "mcp",
      node: "mcp",
      outcome: "success",
      latencyMs: Date.now() - start,
      method: req.method,
      sessionId: newSessionId,
      initialized: true,
    });

    return res;
  } catch (error) {
    log({
      requestId,
      caller: "mcp",
      node: "mcp",
      outcome: "error",
      latencyMs: Date.now() - start,
      method: req.method,
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "internal error" },
        id: null,
      },
      { status: 500 },
    );
  }
}
