import type { Env } from "../../env";
import { log, errorMessage } from "../../lib/logger";
import { setContext } from "../../lib/context";
import type { CancelResult } from "../../actors/appointment-actor";

export interface CancelAppointmentsArgs {
  caller_number: string;
  cancel_by: "time" | "id";
  date?: string;
  start_time?: string;
  appointment_id?: string;
}

export interface CancelAppointmentsResponse {
  cancelled?: { id: string; date: string; start_time: string; end_time: string };
  not_found?: boolean;
  message?: string;
}

export async function handleCancelAppointments(
  args: CancelAppointmentsArgs,
  env: Env,
): Promise<{ status: number; body: CancelAppointmentsResponse }> {
  const caller = args.caller_number ?? "unknown";
  setContext({ tool: "cancel_appointments", caller });

  try {
    const stub = env.APPOINTMENT_SESSIONS.idFromName(caller);
    let result: CancelResult;

    if (args.cancel_by === "time") {
      if (!args.date || !args.start_time) {
        setContext({ outcome: "bad_request" });
        return {
          status: 400,
          body: {
            not_found: true,
            message: "date and start_time are required when cancel_by is 'time'.",
          },
        };
      }
      result = await stub.cancelByTime(args.date, args.start_time);
    } else {
      if (!args.appointment_id) {
        setContext({ outcome: "bad_request" });
        return {
          status: 400,
          body: {
            not_found: true,
            message: "appointment_id is required when cancel_by is 'id'.",
          },
        };
      }
      result = await stub.cancelById(args.appointment_id);
    }

    setContext({ outcome: result.cancelled ? "success" : "not_found" });
    log.info("tool.completed", {
      cancel_by: args.cancel_by,
      found: !!result.cancelled,
    });

    return {
      status: result.cancelled ? 200 : 404,
      body: result,
    };
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("tool.failed", { error: errorMessage(error) });

    return {
      status: 500,
      body: {
        not_found: true,
        message: "internal_error",
      },
    };
  }
}
