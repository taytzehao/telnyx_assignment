import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleGetFaq } from "../src/tools/get-faq";
import { handleCreateAppointment } from "../src/tools/create-appointment";
import { handleListAppointments } from "../src/tools/list-appointments";
import { handleCancelAppointments } from "../src/tools/cancel-appointments";
import { handleToolRequest, END_USER_TARGET_HEADER } from "../src/tools/handler";
import type { Env } from "../src/env";
import { getContext, runWithContext } from "../src/lib/context";

/** Run `fn` inside a request context, as the request middleware would. */
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithContext({ request_id: "req_test" }, fn);
}

function toolCompletedLine(): Record<string, unknown> | undefined {
  return vi
    .mocked(console.log)
    .mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string))
    .find((l: Record<string, unknown>) => l.event === "tool.completed");
}

function createMockEnv() {
  const kvStore = new Map<string, string>();
  const apptStore = new Map<string, unknown>();
  const apptList: unknown[] = [];

  return {
    SESSIONS: {
      get: vi.fn(async (key: string): Promise<string | null> => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string): Promise<void> => {
        kvStore.set(key, value);
      }),
      delete: vi.fn(async (key: string): Promise<void> => {
        kvStore.delete(key);
      }),
      list: vi.fn(async (): Promise<{ keys: { name: string }[]; list_complete: boolean }> => ({
        keys: [...kvStore.keys()].map((name) => ({ name })),
        list_complete: true,
      })),
      _kvStore: kvStore,
    },
    APPOINTMENT_SESSIONS: {
      idFromName: vi.fn(() => ({
        createAppointment: vi.fn(async (date: string, startTime: string) => {
          const existing = apptList as { date: string; start_time: string; end_time: string; id: string }[];
          const startMin = startTimeToMin(startTime);
          const conflicts = existing.filter(
            (a) => a.date === date && startMin < endTimeMin(a) && startMin + 30 > startTimeMin(a),
          );
          if (conflicts.length > 0) {
            return {
              success: false,
              conflict: true,
              conflicts,
              suggestions: ["09:30 - 10:00", "11:00 - 11:30"],
            };
          }
          const appointment = {
            id: `appt_test_${Date.now()}`,
            date,
            start_time: startTime,
            end_time: minToTime(startMin + 30),
          };
          apptList.push(appointment);
          return { success: true, appointment };
        }),
        listAppointments: vi.fn(async () => [...apptList]),
        cancelByTime: vi.fn(async (date: string, startTime: string) => {
          const idx = apptList.findIndex(
            (a) => (a as { date: string; start_time: string }).date === date &&
                   (a as { start_time: string }).start_time === startTime,
          );
          if (idx === -1) return { not_found: true, message: "Not found" };
          const [cancelled] = apptList.splice(idx, 1);
          return { cancelled };
        }),
        cancelById: vi.fn(async (id: string) => {
          const idx = apptList.findIndex((a) => (a as { id: string }).id === id);
          if (idx === -1) return { not_found: true, message: "Not found" };
          const [cancelled] = apptList.splice(idx, 1);
          return { cancelled };
        }),
      })),
      _apptStore: apptStore,
      _apptList: apptList,
    },
    CALL_SESSIONS: {
      idFromName: vi.fn(() => ({
        recordCall: vi.fn(async () => ({ callCount: 1, lastIntent: "" })),
        getState: vi.fn(async () => ({ callCount: 0, lastIntent: "" })),
      })),
    },
    MY_TELNYX: {},
  };
}

function startTimeMin(a: { start_time: string }): number {
  const [h, m] = a.start_time.split(":").map(Number);
  return h * 60 + m;
}
function endTimeMin(a: { end_time: string }): number {
  const [h, m] = a.end_time.split(":").map(Number);
  return h * 60 + m;
}
function startTimeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type MockEnv = ReturnType<typeof createMockEnv>;

describe("tool handlers", () => {
  let env: MockEnv;

  beforeEach(() => {
    env = createMockEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("get_faq", () => {
    it("returns content for each valid category", async () => {
      for (const category of ["hours", "location", "services", "fees"]) {
        const { status, body } = await handleGetFaq(
          { caller_number: "+1234567890", category },
          env as unknown as Env,
        );
        expect(status).toBe(200);
        expect(body.found).toBe(true);
        expect(body.content.length).toBeGreaterThan(0);
      }
    });

    it("returns found=false for unknown category", async () => {
      const { status, body } = await handleGetFaq(
        { caller_number: "+1234567890", category: "insurance" },
        env as unknown as Env,
      );
      expect(status).toBe(200);
      expect(body.found).toBe(false);
    });

    it("emits a structured log with request context, caller, tool, and outcome", async () => {
      await inRequest(() =>
        handleGetFaq(
          { caller_number: "+1234567890", category: "hours" },
          env as unknown as Env,
        ),
      );

      expect(toolCompletedLine()).toMatchObject({
        level: "info",
        request_id: "req_test",
        caller: "+1234567890",
        tool: "get_faq",
        outcome: "success",
        category: "hours",
        found: true,
      });
    });
  });

  describe("create_appointment", () => {
    it("returns 200 on success", async () => {
      const { status, body } = await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.appointment).toBeDefined();
      expect(body.appointment!.date).toBe("2026-01-15");
    });

    it("returns 409 with suggestions on conflict", async () => {
      await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      const { status, body } = await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      expect(status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.conflict).toBe(true);
      expect(body.suggestions).toBeDefined();
      expect(body.suggestions!.length).toBeGreaterThan(0);
    });

    it("emits a structured log on success", async () => {
      await inRequest(() =>
        handleCreateAppointment(
          { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
          env as unknown as Env,
        ),
      );
      expect(toolCompletedLine()).toMatchObject({
        caller: "+1234567890",
        tool: "create_appointment",
        outcome: "success",
        date: "2026-01-15",
        start_time: "10:00",
      });
    });

    it("records a conflict outcome in the request context", async () => {
      const args = { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" };
      await handleCreateAppointment(args, env as unknown as Env);

      const outcome = await inRequest(async () => {
        await handleCreateAppointment(args, env as unknown as Env);
        return getContext()?.outcome;
      });
      expect(outcome).toBe("conflict");
    });
  });

  describe("list_appointments", () => {
    it("returns the caller's appointments (HTTP 200)", async () => {
      await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-16", start_time: "14:00" },
        env as unknown as Env,
      );

      const { status, body } = await handleListAppointments(
        { caller_number: "+1234567890" },
        env as unknown as Env,
      );

      expect(status).toBe(200);
      expect(body.appointments).toHaveLength(2);
    });

    it("returns empty list when caller has no appointments", async () => {
      const { status, body } = await handleListAppointments(
        { caller_number: "+9999999999" },
        env as unknown as Env,
      );
      expect(status).toBe(200);
      expect(body.appointments).toEqual([]);
    });

    it("emits a structured log", async () => {
      await inRequest(() =>
        handleListAppointments(
          { caller_number: "+1234567890" },
          env as unknown as Env,
        ),
      );
      expect(toolCompletedLine()).toMatchObject({
        tool: "list_appointments",
        outcome: "success",
        count: 0,
      });
    });
  });

  describe("cancel_appointments", () => {
    it("returns 200 and the cancelled appointment when found by time", async () => {
      await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );

      const { status, body } = await handleCancelAppointments(
        { caller_number: "+1234567890", cancel_by: "time", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );

      expect(status).toBe(200);
      expect(body.cancelled).toBeDefined();
      expect(body.cancelled!.date).toBe("2026-01-15");
    });

    it("returns 404 when no appointment matches the time", async () => {
      const { status, body } = await handleCancelAppointments(
        { caller_number: "+1234567890", cancel_by: "time", date: "2026-01-20", start_time: "09:00" },
        env as unknown as Env,
      );
      expect(status).toBe(404);
      expect(body.not_found).toBe(true);
    });

    it("cancels by appointment ID (HTTP 200)", async () => {
      const created = await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "11:00" },
        env as unknown as Env,
      );
      const id = created.body.appointment!.id;

      const { status, body } = await handleCancelAppointments(
        { caller_number: "+1234567890", cancel_by: "id", appointment_id: id },
        env as unknown as Env,
      );
      expect(status).toBe(200);
      expect(body.cancelled).toBeDefined();
      expect(body.cancelled!.id).toBe(id);
    });

    it("returns 400 when cancel_by='time' but date/start_time missing", async () => {
      const { status, outcome } = await inRequest(async () => {
        const res = await handleCancelAppointments(
          { caller_number: "+1234567890", cancel_by: "time" },
          env as unknown as Env,
        );
        return { status: res.status, outcome: getContext()?.outcome };
      });
      expect(status).toBe(400);
      expect(outcome).toBe("bad_request");
    });

    it("emits a structured log", async () => {
      await inRequest(() =>
        handleCancelAppointments(
          { caller_number: "+1234567890", cancel_by: "time", date: "2026-01-15", start_time: "10:00" },
          env as unknown as Env,
        ),
      );
      expect(toolCompletedLine()).toMatchObject({
        tool: "cancel_appointments",
        outcome: "not_found",
        cancel_by: "time",
        found: false,
      });
    });

    it("logs tool.failed with error outcome when the actor throws", async () => {
      vi.mocked(env.APPOINTMENT_SESSIONS.idFromName).mockImplementationOnce(() => {
        throw new Error("actor unavailable");
      });

      const { status } = await inRequest(() =>
        handleCancelAppointments(
          { caller_number: "+1234567890", cancel_by: "id", appointment_id: "x" },
          env as unknown as Env,
        ),
      );

      expect(status).toBe(500);
      const failed = vi
        .mocked(console.log)
        .mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string))
        .find((l: Record<string, unknown>) => l.event === "tool.failed");
      expect(failed).toMatchObject({
        level: "error",
        tool: "cancel_appointments",
        outcome: "error",
        error: "actor unavailable",
      });
    });
  });

  describe("tool endpoint (/tools/*)", () => {
    function toolRequest(
      tool: string,
      body: Record<string, unknown>,
      endUserTarget?: string,
    ): Request {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (endUserTarget !== undefined) headers[END_USER_TARGET_HEADER] = endUserTarget;
      return new Request(`https://edge.test/tools/${tool}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }

    it("identifies the caller from the end-user-target header", async () => {
      const res = await handleToolRequest(
        "/tools/list-appointments",
        toolRequest("list-appointments", {}, "+15551234567"),
        env as unknown as Env,
      );
      expect(res.status).toBe(200);
      expect(env.APPOINTMENT_SESSIONS.idFromName).toHaveBeenCalledWith("+15551234567");
    });

    it("ignores a caller_number in the body in favour of the header", async () => {
      const res = await handleToolRequest(
        "/tools/create-appointment",
        toolRequest(
          "create-appointment",
          { caller_number: "+19999999999", date: "2026-01-15", start_time: "10:00" },
          "+15551234567",
        ),
        env as unknown as Env,
      );
      expect(res.status).toBe(200);
      expect(env.APPOINTMENT_SESSIONS.idFromName).toHaveBeenCalledWith("+15551234567");
      expect(env.APPOINTMENT_SESSIONS.idFromName).not.toHaveBeenCalledWith("+19999999999");
    });

    it("reads the header case-insensitively", async () => {
      const req = new Request("https://edge.test/tools/get-faq", {
        method: "POST",
        headers: { "X-End-User-Target": "+15551234567" },
        body: JSON.stringify({ category: "hours" }),
      });
      const res = await inRequest(() =>
        handleToolRequest("/tools/get-faq", req, env as unknown as Env),
      );
      expect(res.status).toBe(200);
      expect(toolCompletedLine()?.caller).toBe("+15551234567");
    });

    it("returns 400 when the header is missing", async () => {
      const res = await handleToolRequest(
        "/tools/list-appointments",
        toolRequest("list-appointments", { caller_number: "+15551234567" }),
        env as unknown as Env,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("missing_end_user_target");
      expect(env.APPOINTMENT_SESSIONS.idFromName).not.toHaveBeenCalled();
    });

    it("returns 400 when the header is blank", async () => {
      const res = await handleToolRequest(
        "/tools/cancel-appointments",
        toolRequest("cancel-appointments", { cancel_by: "id", appointment_id: "x" }, "  "),
        env as unknown as Env,
      );
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown tool", async () => {
      const res = await handleToolRequest(
        "/tools/nope",
        toolRequest("nope", {}, "+15551234567"),
        env as unknown as Env,
      );
      expect(res.status).toBe(404);
    });
  });
});
