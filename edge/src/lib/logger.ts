export interface LogPayload {
  requestId: string;
  caller: string;
  node: string;
  outcome: "success" | "error" | "conflict" | "not_found";
  latencyMs: number;
  error?: string;
  callCount?: number;
  isReturningCaller?: boolean;
  [key: string]: unknown;
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Emit a structured JSON log line. Every webhook call should produce one. */
export function log(payload: LogPayload): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: payload.outcome === "error" ? "error" : "info",
      ...payload,
    }),
  );
}
