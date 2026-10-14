import type { Env } from "./env";
import { log, errorMessage } from "./lib/logger";
import { getContext, setContext } from "./lib/context";
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
  caller_appointments: string;
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
  const body = (await req.json().catch(() => ({}))) as WebhookPayload;
  const callerNumber = body.caller_number ?? "unknown";
  const callSessionId = body.call_session_id ?? "unknown";
  const currentNode = body.current_node ?? "unknown";
  setContext({
    caller: callerNumber,
    node: currentNode,
    call_session_id: callSessionId,
  });

  try {
    const escalationEnabled =
      (await getFlag(env.SESSIONS, "flag/escalation_enabled")) === "true";

    const stub = env.CALL_SESSIONS.idFromName(callerNumber);
    const { callCount, lastIntent } = await stub.recordCall(
      callerNumber,
      currentNode,
    );
    const isReturningCaller = callCount > 1;

    let callerAppointments = "[]";
    try {
      const apptStub = env.APPOINTMENT_SESSIONS.idFromName(callerNumber);
      const appointments = await apptStub.listAppointments();
      callerAppointments = JSON.stringify(appointments);
    } catch (error) {
      // fall back to empty list if actor call fails
      log.warn("webhook.appointments_lookup_failed", {
        error: errorMessage(error),
      });
    }

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
      caller_appointments: callerAppointments,
    };

    setContext({
      outcome: "success",
      call_count: callCount,
      is_returning_caller: isReturningCaller,
    });

    return Response.json({ dynamic_variables: dynamicVars });
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("webhook.failed", { error: errorMessage(error) });

    return Response.json(
      { error: "internal_error", request_id: getContext()?.request_id },
      { status: 500 },
    );
  }
}
