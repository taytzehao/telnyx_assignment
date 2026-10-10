import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleWebhook } from "../src/webhook";

function createMockEnv() {
  const kvStore = new Map<string, string>();
  const actorStore = new Map<string, unknown>();

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
      caller_number: "+1234567890",
      current_node: "greeting",
    });

    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      caller_number: "+1234567890",
      call_session_id: "sess-001",
      current_node: "greeting",
      call_count: 1,
      is_returning_caller: false,
      last_intent: "greeting",
      greeting: "Hello! Thanks for calling.",
      escalation_enabled: false,
    });
  });

  it("marks returning callers correctly on second call", async () => {
    const req1 = webhookRequest({
      call_session_id: "sess-a",
      caller_number: "+1111111111",
      current_node: "greeting",
    });
    await handleWebhook(req1, env as unknown as Parameters<typeof handleWebhook>[1]);

    const req2 = webhookRequest({
      call_session_id: "sess-b",
      caller_number: "+1111111111",
      current_node: "faq",
    });
    const res2 = await handleWebhook(req2, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data2 = await res2.json();

    expect(data2.call_count).toBe(2);
    expect(data2.is_returning_caller).toBe(true);
    expect(data2.greeting).toContain("Welcome back");
    expect(data2.greeting).toContain("#2");
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
      caller_number: "+9999999999",
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
      caller_number: "+2222222222",
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
    env.SESSIONS.put("flag:escalation_enabled", "true");

    const req = webhookRequest({
      caller_number: "+3333333333",
      current_node: "greeting",
    });
    const res = await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);
    const data = await res.json();

    expect(data.escalation_enabled).toBe(true);
    expect(env.SESSIONS.get).toHaveBeenCalledWith("flag:escalation_enabled");
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
    expect(data.caller_number).toBe("unknown");
    expect(data.call_count).toBe(1);
  });

  it("calls the CallSession actor with the caller's number as the actor name", async () => {
    const req = webhookRequest({
      caller_number: "+5555555555",
      current_node: "greeting",
    });
    await handleWebhook(req, env as unknown as Parameters<typeof handleWebhook>[1]);

    expect(env.CALL_SESSIONS.idFromName).toHaveBeenCalledWith("+5555555555");
  });
});
