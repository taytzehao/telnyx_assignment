import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the StatefulActor base class so tests don't need the real runtime.
vi.mock("@telnyx/edge-runtime", () => ({
  StatefulActor: class {
    ctx: unknown;
  },
}));

import { CallSession } from "../../src/actors/call-session";

function createMockStorage() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return store.get(key) as T | undefined;
    }),
    put: vi.fn(async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      store.delete(key);
    }),
    _store: store,
  };
}

describe("CallSession", () => {
  let session: CallSession;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    session = Object.create(CallSession.prototype) as CallSession;
    (session as unknown as { ctx: unknown }).ctx = { storage };
  });

  it("records first call and returns callCount of 1", async () => {
    const result = await session.recordCall("+1234567890", "greeting");

    expect(result.callCount).toBe(1);
    expect(result.lastIntent).toBe("greeting");
    expect(storage.put).toHaveBeenCalledWith("callCount", 1);
    expect(storage.put).toHaveBeenCalledWith("lastIntent", "greeting");
    expect(storage.put).toHaveBeenCalledWith("lastCallerId", "+1234567890");
  });

  it("increments callCount across multiple calls", async () => {
    await session.recordCall("+1234567890", "greeting");
    await session.recordCall("+1234567890", "faq");
    const result = await session.recordCall("+1234567890", "escalate");

    expect(result.callCount).toBe(3);
    expect(result.lastIntent).toBe("escalate");
  });

  it("performs a single read-modify-write (put called once for callCount)", async () => {
    await session.recordCall("+1234567890", "greeting");
    const callCountPuts = storage.put.mock.calls.filter(
      (c) => c[0] === "callCount",
    );
    expect(callCountPuts).toHaveLength(1);
    expect(callCountPuts[0]).toEqual(["callCount", 1]);
  });

  it("records lastCallAt as an ISO string", async () => {
    await session.recordCall("+1234567890", "greeting");
    const lastCallAt = storage._store.get("lastCallAt");
    expect(typeof lastCallAt).toBe("string");
    expect(() => new Date(lastCallAt as string)).not.toThrow();
  });

  it("getState returns current state without mutation", async () => {
    await session.recordCall("+1234567890", "faq");
    const putCountBefore = storage.put.mock.calls.length;

    const state = await session.getState();

    expect(state.callCount).toBe(1);
    expect(state.lastIntent).toBe("faq");
    expect(storage.put.mock.calls.length).toBe(putCountBefore);
  });

  it("getState returns zero count and empty intent for new session", async () => {
    const state = await session.getState();

    expect(state.callCount).toBe(0);
    expect(state.lastIntent).toBe("");
  });

  it("handles negative: RecordCall with empty intent still persists", async () => {
    const result = await session.recordCall("+0000000000", "");
    expect(result.callCount).toBe(1);
    expect(result.lastIntent).toBe("");
    expect(storage._store.get("lastIntent")).toBe("");
  });
});
