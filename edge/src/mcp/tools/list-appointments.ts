import type { Env } from "../../env";
import { log, errorMessage } from "../../lib/logger";
import { setContext } from "../../lib/context";
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
  const caller = args.caller_number ?? "unknown";
  setContext({ tool: "list_appointments", caller });

  try {
    const stub = env.APPOINTMENT_SESSIONS.idFromName(caller);
    const appointments = await stub.listAppointments();

    setContext({ outcome: "success" });
    log.info("tool.completed", { count: appointments.length });

    return {
      status: 200,
      body: { appointments },
    };
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("tool.failed", { error: errorMessage(error) });

    return {
      status: 500,
      body: { appointments: [] },
    };
  }
}
