import type { Env } from "../env";
import { handleGetFaq } from "./tools/get-faq";
import { handleCreateAppointment } from "./tools/create-appointment";
import { handleListAppointments } from "./tools/list-appointments";
import { handleCancelAppointments } from "./tools/cancel-appointments";

export async function handleToolRequest(
  path: string,
  req: Request,
  env: Env,
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (path === "/tools/get-faq") {
    const { status, body: result } = await handleGetFaq(
      body as { caller_number: string; category: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/create-appointment") {
    const { status, body: result } = await handleCreateAppointment(
      body as { caller_number: string; date: string; start_time: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/list-appointments") {
    const { status, body: result } = await handleListAppointments(
      body as { caller_number: string },
      env,
    );
    return Response.json(result, { status });
  }

  if (path === "/tools/cancel-appointments") {
    const { status, body: result } = await handleCancelAppointments(
      body as {
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
