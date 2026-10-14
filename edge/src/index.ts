// Re-export the actor classes so they are bundled and shipped with the function.
// The exported class name must match the `type` field in telnyx.toml [[actors]].
export { CallSession } from "./actors/call-session";
export { AppointmentActor } from "./actors/appointment-actor";

import type { Env } from "./env";
import { handleWebhook } from "./webhook";
import { handleToolRequest } from "./tools/handler";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (
      url.pathname === "/health/liveness" ||
      url.pathname === "/health/readiness"
    ) {
      return new Response("ok");
    }

    if (url.pathname === "/webhook" && req.method === "POST") {
      return handleWebhook(req, env);
    }

    if (url.pathname.startsWith("/tools/") && req.method === "POST") {
      return handleToolRequest(url.pathname, req, env);
    }

    return new Response("not found", { status: 404 });
  },
};
