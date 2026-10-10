import type { Env } from "./env";
import { log, generateRequestId } from "./lib/logger";
import { getFlag } from "./lib/kv";

interface WebhookPayload {
  call_session_id?: string;
  caller_number?: string;
  current_node?: string;
  [key: string]: unknown;
}

interface DynamicVariables {
  caller_number: string;
  call_session_id: string;
  current_node: string;
  call_count: number;
  is_returning_caller: boolean;
  last_intent: string;
  greeting: string;
  escalation_enabled: boolean;
}

/**
 * Dynamic Webhook Variables handler.
 *
 * Called by the Telnyx AI Assistant at each workflow node to personalize
 * the conversation. Reads KV feature flags, updates the caller's
 * CallSession actor, and returns dynamic variables that can influence
 * workflow routing (e.g. `is_returning_caller`, `escalation_enabled`).
 *
 * The `greeting` variable is interpolated verbatim by the Greeting speak
 * node — the speak node delivers the text word-for-word without an LLM
 * turn, so the greeting content here is exactly what the caller hears.
 */
export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const requestId = generateRequestId();
  const start = Date.now();

  const body = (await req.json().catch(() => ({}))) as WebhookPayload;
  const callerNumber = body.caller_number ?? "unknown";
  const callSessionId = body.call_session_id ?? "unknown";
  const currentNode = body.current_node ?? "unknown";

  try {
    const escalationEnabled =
      (await getFlag(env.SESSIONS, "flag/escalation_enabled")) === "true";

    const stub = env.CALL_SESSIONS.idFromName(callerNumber);
    const { callCount, lastIntent } = await stub.recordCall(
      callerNumber,
      currentNode,
    );
    const isReturningCaller = callCount > 1;

    const dynamicVars: DynamicVariables = {
      caller_number: callerNumber,
      call_session_id: callSessionId,
      current_node: currentNode,
      call_count: callCount,
      is_returning_caller: isReturningCaller,
      last_intent: lastIntent,
      greeting: isReturningCaller
        ? `Welcome back! This is your call #${callCount}.`
        : "Hello! Thanks for calling.",
      escalation_enabled: escalationEnabled,
    };

    const latencyMs = Date.now() - start;
    log({
      requestId,
      caller: callerNumber,
      node: currentNode,
      outcome: "success",
      latencyMs,
      callCount,
      isReturningCaller,
    });

    return Response.json(dynamicVars);
  } catch (error) {
    const latencyMs = Date.now() - start;
    log({
      requestId,
      caller: callerNumber,
      node: currentNode,
      outcome: "error",
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    });

    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500 },
    );
  }
}
