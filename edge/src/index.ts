// Re-export the actor classes so they are bundled and shipped with the function.
// The exported class name must match the `type` field in telnyx.toml [[actors]].
export { CallSession } from "./actors/call-session";
export { AppointmentActor } from "./actors/appointment-actor";

import type { Env } from "./env";
import { handleWebhook } from "./webhook";
import { handleMcpRequest } from "./mcp/handler";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Liveness/readiness probes — answer before any other work.
    if (
      url.pathname === "/health/liveness" ||
      url.pathname === "/health/readiness"
    ) {
      return new Response("ok");
    }

    // Dynamic webhook variables endpoint.
    if (url.pathname === "/webhook" && req.method === "POST") {
      return handleWebhook(req, env);
    }

    // MCP server endpoint (Streamable HTTP transport).
    if (url.pathname === "/mcp") {
      return handleMcpRequest(req, env);
    }

    return new Response("not found", { status: 404 });
  },
};
