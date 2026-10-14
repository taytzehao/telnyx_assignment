import type { Env } from "../env";
import {
  contextFromRequest,
  getContext,
  runWithContext,
  setContext,
  type Outcome,
} from "./context";
import { log, errorMessage } from "./logger";

export type Handler = (req: Request, env: Env) => Promise<Response>;

function outcomeFromStatus(status: number): Outcome {
  if (status >= 500) return "error";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 400) return "bad_request";
  return "success";
}

/**
 * Wrap a handler so each request runs inside its own log context (seeded from
 * correlation headers) and emits a single `request.completed` line with the
 * status, outcome, and duration once the handler finishes.
 */
export function withRequestLogging(handler: Handler): Handler {
  return (req, env) =>
    runWithContext(contextFromRequest(req), async () => {
      const start = performance.now();
      let status = 500;

      if (!getContext()?.end_user_target) {
        log.warn("request.missing_end_user_target");
      }

      try {
        const res = await handler(req, env);
        status = res.status;
        return res;
      } catch (error) {
        setContext({ outcome: "error" });
        log.error("request.unhandled_error", { error: errorMessage(error) });
        return Response.json(
          { error: "internal_error", request_id: getContext()?.request_id },
          { status: 500 },
        );
      } finally {
        const fields = {
          status,
          outcome: getContext()?.outcome ?? outcomeFromStatus(status),
          duration_ms: Math.round(performance.now() - start),
        };
        if (status >= 500) log.error("request.completed", fields);
        else log.info("request.completed", fields);
      }
    });
}
