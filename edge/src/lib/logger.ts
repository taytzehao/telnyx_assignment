import { getContext } from "./context";

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

/**
 * Emit a structured JSON log line. The active request context (request_id,
 * correlation_id, session_id, caller, node, ...) is merged in automatically.
 */
function emit(level: Level, event: string, fields?: Fields): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...getContext(),
      ...fields,
    }),
  );
}

export const log = {
  info: (event: string, fields?: Fields): void => emit("info", event, fields),
  warn: (event: string, fields?: Fields): void => emit("warn", event, fields),
  error: (event: string, fields?: Fields): void => emit("error", event, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
