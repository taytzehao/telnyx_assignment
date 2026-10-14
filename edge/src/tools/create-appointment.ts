import type { Env } from "../env";
import { log, errorMessage } from "../lib/logger";
import { setContext } from "../lib/context";
import type { CreateResult } from "../actors/appointment-actor";

export interface CreateAppointmentArgs {
  caller_number: string;
  date: string;
  start_time: string;
}

export interface CreateAppointmentResponse {
  success: boolean;
  appointment?: { id: string; date: string; start_time: string; end_time: string };
  conflict?: boolean;
  conflicts?: { id: string; date: string; start_time: string; end_time: string }[];
  suggestions?: string[];
  error?: string;
}

export async function handleCreateAppointment(
  args: CreateAppointmentArgs,
  env: Env,
): Promise<{ status: number; body: CreateAppointmentResponse }> {
  const caller = args.caller_number ?? "unknown";
  setContext({ tool: "create_appointment", caller });

  try {
    const stub = env.APPOINTMENT_SESSIONS.idFromName(caller);
    const result: CreateResult = await stub.createAppointment(
      args.date,
      args.start_time,
    );

    setContext({ outcome: result.success ? "success" : "conflict" });
    log.info("tool.completed", {
      date: args.date,
      start_time: args.start_time,
      success: result.success,
    });

    return {
      status: result.success ? 200 : 409,
      body: result,
    };
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("tool.failed", { error: errorMessage(error) });

    return {
      status: 500,
      body: {
        success: false,
        error: "internal_error",
      },
    };
  }
}
