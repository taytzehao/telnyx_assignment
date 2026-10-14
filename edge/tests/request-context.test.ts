import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";
import { getContext, setContext } from "../src/lib/context";
import { log } from "../src/lib/logger";
import { withRequestLogging, type Handler } from "../src/lib/middleware";

const env = {
  SESSIONS: { get: vi.fn(async () => null) },
} as unknown as Env;

function logLines(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string));
}

function request(headers: Record<string, string> = {}, path = "/x"): Request {
  return new Request(`https://edge.test${path}`, { method: "POST", headers });
}

const ok: Handler = async () => new Response("ok");

describe("withRequestLogging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts correlation headers on every log line in the request", async () => {
    const handler: Handler = async () => {
      log.info("inside");
      return new Response("ok");
    };

    await withRequestLogging(handler)(
      request({
        "x-request-id": "r1",
        "x-correlation-id": "c1",
        "x-session-id": "s1",
        "x-end-user-target": "+15550001111",
      }),
      env,
    );

    const lines = logLines();
    expect(lines.map((l) => l.event)).toEqual(["inside", "request.completed"]);
    for (const line of lines) {
      expect(line).toMatchObject({
        request_id: "r1",
        correlation_id: "c1",
        session_id: "s1",
        end_user_target: "+15550001111",
        method: "POST",
        path: "/x",
      });
    }
  });

  it("generates request_id and omits correlation_id/session_id when headers are missing", async () => {
    await withRequestLogging(ok)(request(), env);

    const completed = logLines().find((l) => l.event === "request.completed")!;
    expect(completed.request_id).toMatch(/^req_/);
    expect(completed).not.toHaveProperty("correlation_id");
    expect(completed).not.toHaveProperty("session_id");
    expect(completed).not.toHaveProperty("end_user_target");
  });

  it("warns once when x-end-user-target is missing", async () => {
    await withRequestLogging(ok)(request(), env);

    const warns = logLines().filter((l) => l.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].event).toBe("request.missing_end_user_target");
  });

  it("does not warn when x-end-user-target is present", async () => {
    await withRequestLogging(ok)(request({ "x-end-user-target": "+1555" }), env);

    expect(logLines().filter((l) => l.level === "warn")).toHaveLength(0);
  });

  it("does not warn when the handler sets end_user_target from the body", async () => {
    await withRequestLogging(async () => {
      setContext({ end_user_target: "+1555" });
      return new Response("ok");
    })(request(), env);

    expect(logLines().filter((l) => l.level === "warn")).toHaveLength(0);
    expect(logLines().find((l) => l.event === "request.completed")).toMatchObject({
      end_user_target: "+1555",
    });
  });

  it("emits one request.completed line with status, outcome, and duration_ms", async () => {
    await withRequestLogging(ok)(request(), env);

    const completed = logLines().filter((l) => l.event === "request.completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      level: "info",
      status: 200,
      outcome: "success",
    });
    expect(typeof completed[0].duration_ms).toBe("number");
  });

  it("derives outcome from status, unless the handler set one", async () => {
    await withRequestLogging(async () => new Response(null, { status: 409 }))(
      request(),
      env,
    );
    await withRequestLogging(async () => {
      setContext({ outcome: "not_found" });
      return new Response("ok");
    })(request(), env);

    const outcomes = logLines()
      .filter((l) => l.event === "request.completed")
      .map((l) => l.outcome);
    expect(outcomes).toEqual(["conflict", "not_found"]);
  });

  it("returns 500 and logs an error when the handler throws", async () => {
    const res = await withRequestLogging(async () => {
      throw new Error("boom");
    })(request({ "x-request-id": "r-err" }), env);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "internal_error",
      request_id: "r-err",
    });

    const lines = logLines();
    expect(lines.find((l) => l.event === "request.unhandled_error")).toMatchObject({
      level: "error",
      error: "boom",
    });
    expect(lines.find((l) => l.event === "request.completed")).toMatchObject({
      level: "error",
      status: 500,
      outcome: "error",
    });
  });

  it("keeps context isolated between concurrent requests", async () => {
    const handler: Handler = async (req) => {
      const delay = Number(req.headers.get("x-delay"));
      setContext({ caller: req.headers.get("x-request-id") ?? "" });
      await new Promise((resolve) => setTimeout(resolve, delay));
      log.info("probe", { expected: req.headers.get("x-request-id") });
      return new Response("ok");
    };
    const wrapped = withRequestLogging(handler);

    await Promise.all([
      wrapped(request({ "x-request-id": "slow", "x-delay": "20" }), env),
      wrapped(request({ "x-request-id": "fast", "x-delay": "1" }), env),
    ]);

    const probes = logLines().filter((l) => l.event === "probe");
    expect(probes.map((p) => p.expected)).toEqual(["fast", "slow"]);
    for (const probe of probes) {
      expect(probe.request_id).toBe(probe.expected);
      expect(probe.caller).toBe(probe.expected);
    }
  });

  it("treats getContext/setContext outside a request as safe no-ops", () => {
    expect(getContext()).toBeUndefined();
    expect(() => setContext({ caller: "x" })).not.toThrow();
    expect(getContext()).toBeUndefined();
  });
});

describe("router", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not log health probes", async () => {
    const res = await worker.fetch(
      new Request("https://edge.test/health/liveness"),
      env,
    );

    expect(res.status).toBe(200);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("logs unknown routes as not_found", async () => {
    await worker.fetch(request({}, "/nope"), env);

    expect(logLines().find((l) => l.event === "request.completed")).toMatchObject({
      path: "/nope",
      status: 404,
      outcome: "not_found",
    });
  });

  it("carries tool context onto the /tools request.completed line", async () => {
    const res = await worker.fetch(
      new Request("https://edge.test/tools/get-faq", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "r-tool",
          "x-end-user-target": "+15550002222",
        },
        body: JSON.stringify({ category: "hours" }),
      }),
      env,
    );
    expect(res.status).toBe(200);

    const lines = logLines();
    expect(lines.find((l) => l.event === "tool.completed")).toMatchObject({
      request_id: "r-tool",
      tool: "get_faq",
    });
    expect(lines.find((l) => l.event === "request.completed")).toMatchObject({
      request_id: "r-tool",
      path: "/tools/get-faq",
      end_user_target: "+15550002222",
      tool: "get_faq",
      caller: "+15550002222",
      outcome: "success",
      status: 200,
    });
  });
});
