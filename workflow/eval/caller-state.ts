import type { SeedAppointment } from "./types";

/** Puts a test caller's appointments into a known state before a run. */
export interface CallerStatePreparer {
  prepare(callerId: string, seeds: SeedAppointment[]): Promise<void>;
}

/**
 * The caller identity Telnyx uses for an assistant test run.
 *
 * In test runs `telnyx_end_user_target` is `ai-assistant-test-<test_id>`, so
 * every test is its own caller with its own AppointmentActor, and that state
 * carries over between runs of the same test.
 */
export function testCallerId(testId: string): string {
  return `ai-assistant-test-${testId}`;
}

/** Must match `END_USER_TARGET_HEADER` in `edge/src/tools/handler.ts`. */
const END_USER_TARGET_HEADER = "X-End-User-Target";

interface ListedAppointment {
  id: string;
}

/**
 * Prepares caller state through the deployed edge's own tool endpoints — the
 * same path the assistant uses — so seeded appointments are exactly what the
 * assistant will see.
 */
export class EdgeCallerState implements CallerStatePreparer {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
  }

  async prepare(callerId: string, seeds: SeedAppointment[]): Promise<void> {
    const { appointments } = await this.callTool<{ appointments: ListedAppointment[] }>(
      callerId,
      "list-appointments",
      {},
    );
    for (const appointment of appointments) {
      await this.callTool(callerId, "cancel-appointments", {
        cancel_by: "id",
        appointment_id: appointment.id,
      });
    }
    for (const seed of seeds) {
      await this.callTool(callerId, "create-appointment", seed);
    }
  }

  private async callTool<T>(callerId: string, tool: string, body: object): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", [END_USER_TARGET_HEADER]: callerId },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Preparing caller ${callerId}: ${tool} returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }
}
