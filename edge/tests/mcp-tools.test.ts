import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleGetFaq } from "../src/mcp/tools/get-faq";
import { handleCreateAppointment } from "../src/mcp/tools/create-appointment";
import { handleListAppointments } from "../src/mcp/tools/list-appointments";
import { handleCancelAppointments } from "../src/mcp/tools/cancel-appointments";
import type { Env } from "../src/env";

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

describe("MCP tool handlers", () => {
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

    it("emits a structured log with caller, tool, outcome, and latency", async () => {
      await handleGetFaq(
        { caller_number: "+1234567890", category: "hours" },
        env as unknown as Env,
      );

      const logCalls = vi.mocked(console.log).mock.calls;
      expect(logCalls.length).toBeGreaterThanOrEqual(1);
      const logged = JSON.parse(logCalls[0][0] as string);
      expect(logged.caller).toBe("+1234567890");
      expect(logged.tool).toBe("get_faq");
      expect(logged.outcome).toBe("success");
      expect(logged).toHaveProperty("latencyMs");
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
      await handleCreateAppointment(
        { caller_number: "+1234567890", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      const logCalls = vi.mocked(console.log).mock.calls;
      const logged = JSON.parse(logCalls[0][0] as string);
      expect(logged.caller).toBe("+1234567890");
      expect(logged.tool).toBe("create_appointment");
      expect(logged.outcome).toBe("success");
      expect(logged).toHaveProperty("latencyMs");
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
      await handleListAppointments(
        { caller_number: "+1234567890" },
        env as unknown as Env,
      );
      const logCalls = vi.mocked(console.log).mock.calls;
      const logged = JSON.parse(logCalls[0][0] as string);
      expect(logged.tool).toBe("list_appointments");
      expect(logged.outcome).toBe("success");
      expect(logged).toHaveProperty("latencyMs");
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
      const { status } = await handleCancelAppointments(
        { caller_number: "+1234567890", cancel_by: "time" },
        env as unknown as Env,
      );
      expect(status).toBe(400);
    });

    it("emits a structured log", async () => {
      await handleCancelAppointments(
        { caller_number: "+1234567890", cancel_by: "time", date: "2026-01-15", start_time: "10:00" },
        env as unknown as Env,
      );
      const logCalls = vi.mocked(console.log).mock.calls;
      const logged = JSON.parse(logCalls[0][0] as string);
      expect(logged.tool).toBe("cancel_appointments");
      expect(logged).toHaveProperty("latencyMs");
    });
  });
});
