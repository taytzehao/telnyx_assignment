import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleWebhook } from "../src/webhook";

function createMockEnv() {
  const kvStore = new Map<string, string>();
  const actorStore = new Map<string, unknown>();
  const apptStore = new Map<string, unknown[]>();

  return {
    SESSIONS: {
      get: vi.fn(async (key: string): Promise<string | null> => {
        return kvStore.get(key) ?? null;
      }),
      put: vi.fn(async (key: string, value: string): Promise<void> => {
        kvStore.set(key, value);
      }),
      delete: vi.fn(async (key: string): Promise<void> => {
        kvStore.delete(key);
      }),
      list: vi.fn(async (): Promise<{ keys: string[] }> => ({
        keys: [...kvStore.keys()],
      })),
      _kvStore: kvStore,
    },
    CALL_SESSIONS: {
      idFromName: vi.fn(() => ({
        recordCall: vi.fn(async (callerId: string, intent: string) => {
          const count = ((actorStore.get("callCount") as number) ?? 0) + 1;
          actorStore.set("callCount", count);
          actorStore.set("lastIntent", intent);
          return { callCount: count, lastIntent: intent };
        }),
        getState: vi.fn(async () => ({
          callCount: (actorStore.get("callCount") as number) ?? 0,
          lastIntent: (actorStore.get("lastIntent") as string) ?? "",
        })),
      })),
      _actorStore: actorStore,
    },
    APPOINTMENT_SESSIONS: {
      idFromName: vi.fn((callerNumber: string) => ({
        listAppointments: vi.fn(async () => {
          return apptStore.get(callerNumber) ?? [];
        }),
      })),
      _apptStore: apptStore,
    },
    MY_TELNYX: {},
  };
}

type MockEnv = ReturnType<typeof createMockEnv>;

function webhookRequest(body: Record<string, unknown>): Request {
  return new Request("https://edge.test/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleWebhook", () => {
  let env: MockEnv;

  beforeEach(() => {
    env = createMockEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with dynamic variables for a new caller", async () => {
    const req = webhookRequest({
      call_session_id: "sess-001",
      data: { payload: { telnyx_end_user_target: "+1234567890" } },
      current_node: "greeting",
    });

    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      dynamic_variables: {
        call_session_id: "sess-001",
        current_node: "greeting",
        call_count: 1,
        is_returning_caller: false,
        last_intent: "greeting",
        greeting: "Hello! Thanks for calling.",
        escalation_enabled: false,
        caller_appointments: "[]",
      },
    });
  });

  it("marks returning callers correctly on second call", async () => {
    const req1 = webhookRequest({
      call_session_id: "sess-a",
      data: { payload: { telnyx_end_user_target: "+1111111111" } },
      current_node: "greeting",
    });
    await handleWebhook(req1, env as unknown as Parameters<typeof handleWebhook>[1]);

    const req2 = webhookRequest({
      call_session_id: "sess-b",
      data: { payload: { telnyx_end_user_target: "+1111111111" } },
      current_node: "faq",
    });
    const res2 = await handleWebhook(req2, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data2 = await res2.json();

    expect(data2.dynamic_variables.call_count).toBe(2);
    expect(data2.dynamic_variables.is_returning_caller).toBe(true);
    expect(data2.dynamic_variables.greeting).toContain("Welcome back");
    expect(data2.dynamic_variables.greeting).toContain("#2");
  });

  it("returns 500 and logs error when the actor throws", async () => {
    const brokenEnv: MockEnv = createMockEnv();
    vi.mocked(brokenEnv.CALL_SESSIONS.idFromName).mockReturnValueOnce({
      recordCall: vi.fn(async () => {
        throw new Error("actor unavailable");
      }),
      getState: vi.fn(),
    });

    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+9999999999" } },
      current_node: "greeting",
    });
    const res = await handleWebhook(req, brokenEnv as unknown as Parameters<typeof handleWebhook>[1]);

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("internal_error");
    expect(data.request_id).toMatch(/^req_/);

    const logCalls = vi.mocked(console.log).mock.calls;
    const hasErrorLog = logCalls.some(
      (c: unknown[]) => String(c[0]).includes('"outcome":"error"'),
    );
    expect(hasErrorLog).toBe(true);
  });

  it("emits structured log with caller, node, outcome, and latencyMs", async () => {
    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+2222222222" } },
      call_session_id: "sess-log",
      current_node: "identify_intent",
    });
    await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);

    const logCalls = vi.mocked(console.log).mock.calls;
    expect(logCalls.length).toBeGreaterThanOrEqual(1);

    const logged = JSON.parse(logCalls[0][0] as string);
    expect(logged.caller).toBe("+2222222222");
    expect(logged.node).toBe("identify_intent");
    expect(logged.outcome).toBe("success");
    expect(logged).toHaveProperty("latencyMs");
    expect(logged).toHaveProperty("requestId");
    expect(logged).toHaveProperty("timestamp");
  });

  it("reads escalation flag from KV and returns it", async () => {
    env.SESSIONS.put("flag/escalation_enabled", "true");

    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+3333333333" } },
      current_node: "greeting",
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(data.dynamic_variables.escalation_enabled).toBe(true);
    expect(env.SESSIONS.get).toHaveBeenCalledWith("flag/escalation_enabled");
  });

  it("handles negative: malformed JSON body uses defaults", async () => {
    const req = new Request("https://edge.test/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dynamic_variables).not.toHaveProperty("caller_number");
    expect(env.CALL_SESSIONS.idFromName).toHaveBeenCalledWith("unknown");
    expect(data.dynamic_variables.call_count).toBe(1);
  });

  it("calls the CallSession actor with telnyx_end_user_target as the actor name", async () => {
    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+5555555555" } },
      current_node: "greeting",
    });
    await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);

    expect(env.CALL_SESSIONS.idFromName).toHaveBeenCalledWith("+5555555555");
  });

  it("returns caller_appointments as [] when the caller has no appointments", async () => {
    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+7777777777" } },
      current_node: "n_appt_menu",
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(data.dynamic_variables.caller_appointments).toBe("[]");
  });

  it("returns caller_appointments as JSON when the caller has appointments", async () => {
    const appointments = [
      { id: "appt-1", date: "2026-01-15", start_time: "10:00", end_time: "10:30" },
      { id: "appt-2", date: "2026-01-20", start_time: "14:00", end_time: "14:30" },
    ];
    env.APPOINTMENT_SESSIONS._apptStore.set("+8888888888", appointments);

    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+8888888888" } },
      current_node: "n_appt_menu",
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(JSON.parse(data.dynamic_variables.caller_appointments)).toEqual(appointments);
  });

  it("calls the AppointmentSession actor with telnyx_end_user_target", async () => {
    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+6666666666" } },
      current_node: "n_appt_menu",
    });
    await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);

    expect(env.APPOINTMENT_SESSIONS.idFromName).toHaveBeenCalledWith("+6666666666");
  });

  it("ignores a top-level caller_number and uses telnyx_end_user_target", async () => {
    const req = webhookRequest({
      caller_number: "+1000000000",
      current_node: "greeting",
      data: { payload: { telnyx_end_user_target: "+4444444444" } },
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(env.CALL_SESSIONS.idFromName).toHaveBeenCalledWith("+4444444444");
    expect(env.APPOINTMENT_SESSIONS.idFromName).toHaveBeenCalledWith("+4444444444");
    expect(data.dynamic_variables).not.toHaveProperty("caller_number");
  });

  it("falls back to [] when the AppointmentSession actor throws", async () => {
    vi.mocked(env.APPOINTMENT_SESSIONS.idFromName).mockReturnValueOnce({
      listAppointments: vi.fn(async () => {
        throw new Error("actor unavailable");
      }),
    });

    const req = webhookRequest({
      data: { payload: { telnyx_end_user_target: "+9999999999" } },
      current_node: "n_appt_menu",
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dynamic_variables.caller_appointments).toBe("[]");
  });
});
