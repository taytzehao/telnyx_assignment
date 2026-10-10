import type { Env } from "../../env";
import { log, generateRequestId } from "../../lib/logger";
import type { Appointment } from "../../actors/appointment-actor";

export interface ListAppointmentsArgs {
  caller_number: string;
}

export interface ListAppointmentsResponse {
  appointments: Appointment[];
}

export async function handleListAppointments(
  args: ListAppointmentsArgs,
  env: Env,
): Promise<{ status: number; body: ListAppointmentsResponse }> {
  const requestId = generateRequestId();
  const start = Date.now();
  const tool = "list_appointments";
  const caller = args.caller_number ?? "unknown";

  try {
    const stub = env.APPOINTMENT_SESSIONS.idFromName(caller);
    const appointments = await stub.listAppointments();

    log({
      requestId,
      caller,
      node: tool,
      outcome: "success",
      latencyMs: Date.now() - start,
      tool,
      count: appointments.length,
    });

    return {
      status: 200,
      body: { appointments },
    };
  } catch (error) {
    log({
      requestId,
      caller,
      node: tool,
      outcome: "error",
      latencyMs: Date.now() - start,
      tool,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: 500,
      body: { appointments: [] },
    };
  }
}
