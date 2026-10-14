import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "../env";
import { createMcpServer } from "./server";
import { log, errorMessage } from "../lib/logger";
import { setContext } from "../lib/context";

const sessions = new Map<string, McpServerWithTransport>();

interface McpServerWithTransport {
  server: ReturnType<typeof createMcpServer>;
  transport: WebStandardStreamableHTTPServerTransport;
}

export async function handleMcpRequest(req: Request, env: Env): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id") ?? undefined;
  setContext({ mcp_session_id: sessionId });

  try {
    if (req.method === "DELETE" && sessionId) {
      const session = sessions.get(sessionId);
      if (session) {
        await session.server.close();
        await session.transport.close();
        sessions.delete(sessionId);
      }
      return new Response(null, { status: 204 });
    }

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      return await session.transport.handleRequest(req);
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
    setContext({ mcp_session_id: newSessionId, mcp_initialized: true });

    return res;
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("mcp.failed", { error: errorMessage(error) });

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
