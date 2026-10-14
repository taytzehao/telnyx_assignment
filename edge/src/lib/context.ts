import { AsyncLocalStorage } from "node:async_hooks";

export type Outcome =
  | "success"
  | "error"
  | "conflict"
  | "not_found"
  | "bad_request";

/** Request-scoped fields attached to every log line emitted during a request. */
export interface LogContext {
  request_id: string;
  correlation_id?: string;
  session_id?: string;
  end_user_target?: string;
  method?: string;
  path?: string;
  caller?: string;
  node?: string;
  tool?: string;
  outcome?: Outcome;
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Run `fn` with `ctx` as the active context (like Go's ctx / Python's contextvars). */
export function runWithContext<T>(ctx: LogContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The active request context, or undefined outside a request. */
export function getContext(): Readonly<LogContext> | undefined {
  return storage.getStore();
}

/**
 * Add fields to the active request context. Mutates the current store so the
 * request middleware's completion log sees them. No-op outside a request.
 */
export function setContext(fields: Partial<LogContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, fields);
}

/** Build the initial context for a request from its correlation headers. */
export function contextFromRequest(req: Request): LogContext {
  const headers = req.headers;
  return {
    request_id: headers.get("x-request-id") ?? generateRequestId(),
    correlation_id: headers.get("x-correlation-id") ?? undefined,
    session_id: headers.get("x-session-id") ?? undefined,
    end_user_target: headers.get("x-end-user-target") ?? undefined,
    method: req.method,
    path: new URL(req.url).pathname,
  };
}
