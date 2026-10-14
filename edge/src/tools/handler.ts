import type { Env } from "../env";
import { handleGetFaq } from "./get-faq";
import { handleCreateAppointment } from "./create-appointment";
import { handleListAppointments } from "./list-appointments";
import { handleCancelAppointments } from "./cancel-appointments";

/**
 * Header carrying the caller's identity on every webhook tool call.
 *
 * Each shared webhook tool is registered (see `scripts/deploy-assistant.ts`)
 * with this header set to `{{telnyx_end_user_target}}`, which Telnyx
 * interpolates with the end user's phone number. The caller is never taken
 * from the LLM-supplied request body.
 */
export const END_USER_TARGET_HEADER = "x-end-user-target";

export async function handleToolRequest(
  path: string,
  req: Request,
  env: Env,
): Promise<Response> {
  const endUserTarget = req.headers.get(END_USER_TARGET_HEADER)?.trim();
  if (!endUserTarget) {
    return Response.json(
      { error: "missing_end_user_target", message: `${END_USER_TARGET_HEADER} header is required.` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const args = { ...body, caller_number: endUserTarget };

  if (path === "/tools/get-faq") {
    const { status, body: result } = await handleGetFaq(
      args as { caller_number: string; category: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/create-appointment") {
    const { status, body: result } = await handleCreateAppointment(
      args as { caller_number: string; date: string; start_time: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/list-appointments") {
    const { status, body: result } = await handleListAppointments(
      args as { caller_number: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/cancel-appointments") {
    const { status, body: result } = await handleCancelAppointments(
      args as {
        caller_number: string;
        cancel_by: "time" | "id";
        date?: string;
        start_time?: string;
        appointment_id?: string;
      },
      env,
    );
    return Response.json(result, { status });
  }

  return Response.json({ error: "unknown_tool" }, { status: 404 });
}
