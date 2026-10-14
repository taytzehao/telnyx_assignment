import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";

function createMockEnv() {
  return {
    SESSIONS: {
      get: vi.fn(async (): Promise<string | null> => null),
      put: vi.fn(async (): Promise<void> => {}),
      delete: vi.fn(async (): Promise<void> => {}),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    },
    CALL_SESSIONS: {
      idFromName: vi.fn(() => ({
        recordCall: vi.fn(async () => ({ callCount: 1, lastIntent: "" })),
        getState: vi.fn(async () => ({ callCount: 0, lastIntent: "" })),
      })),
    },
    APPOINTMENT_SESSIONS: {
      idFromName: vi.fn(() => ({
        listAppointments: vi.fn(async () => []),
      })),
    },
    MY_TELNYX: {},
  };
}

describe("edge router", () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv() as unknown as Env;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers health probes", async () => {
    const res = await worker.fetch(new Request("https://edge.test/health/liveness"), env);
    expect(res.status).toBe(200);
  });

  it("routes POST /tools/* to the tool handler", async () => {
    const res = await worker.fetch(
      new Request("https://edge.test/tools/list-appointments", {
        method: "POST",
        headers: { "x-end-user-target": "+15551234567" },
        body: "{}",
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appointments: [] });
  });

  it.each(["GET", "POST", "DELETE"])("has no /mcp endpoint (%s → 404)", async (method) => {
    const res = await worker.fetch(
      new Request("https://edge.test/mcp", {
        method,
        body: method === "POST" ? "{}" : undefined,
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
