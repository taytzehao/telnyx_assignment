import { StatefulActor } from "@telnyx/edge-runtime";

export interface CallRecord {
  callCount: number;
  lastIntent: string;
}

/**
 * Per-caller session state managed by a Stateful Actor.
 *
 * Each caller's phone number maps to a dedicated actor instance via
 * `env.CALL_SESSIONS.idFromName(callerNumber)`. The single-threaded
 * dispatch guarantees that `recordCall`'s read-modify-write on
 * `callCount` is safe — two concurrent calls from the same number
 * serialize automatically instead of both reading the same count.
 */
export class CallSession extends StatefulActor {
  /**
   * Record an incoming call: increment the per-caller call counter and
   * store the latest intent. Returns the updated state.
   */
  async recordCall(callerId: string, intent: string): Promise<CallRecord> {
    const callCount = (await this.ctx.storage.get<number>("callCount")) ?? 0;
    const next = callCount + 1;

    await this.ctx.storage.put("callCount", next);
    await this.ctx.storage.put("lastIntent", intent);
    await this.ctx.storage.put("lastCallerId", callerId);
    await this.ctx.storage.put("lastCallAt", new Date().toISOString());

    return { callCount: next, lastIntent: intent };
  }

  /** Read the current session state without mutating it. */
  async getState(): Promise<CallRecord> {
    const callCount = (await this.ctx.storage.get<number>("callCount")) ?? 0;
    const lastIntent = (await this.ctx.storage.get<string>("lastIntent")) ?? "";
    return { callCount, lastIntent };
  }
}
