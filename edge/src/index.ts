// Re-export the actor class so it is bundled and shipped with the function.
// The exported class name must match the `type` field in telnyx.toml [[actors]].
export { CallSession } from "./actors/call-session";

import type { Env } from "./env";
import { handleWebhook } from "./webhook";

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

    return new Response("not found", { status: 404 });
  },
};
