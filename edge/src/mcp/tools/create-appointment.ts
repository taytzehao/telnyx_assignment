import type { Env } from "../../env";
import { log, generateRequestId } from "../../lib/logger";
import type { CreateResult } from "../../actors/appointment-actor";

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
  const requestId = generateRequestId();
  const start = Date.now();
  const tool = "create_appointment";
  const caller = args.caller_number ?? "unknown";

  try {
    const stub = env.APPOINTMENT_SESSIONS.idFromName(caller);
    const result: CreateResult = await stub.createAppointment(
      args.date,
      args.start_time,
    );

    log({
      requestId,
      caller,
      node: tool,
      outcome: result.success ? "success" : "conflict",
      latencyMs: Date.now() - start,
      tool,
      date: args.date,
      start_time: args.start_time,
      success: result.success,
    });

    return {
      status: result.success ? 200 : 409,
      body: result,
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
      body: {
        success: false,
        error: "internal_error",
      },
    };
  }
}
