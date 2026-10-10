import { describe, it, expect, vi } from "vitest";

vi.mock("@telnyx/edge-runtime", () => ({
  StatefulActor: class {
    ctx: unknown;
  },
}));

import {
  AppointmentActor,
  type Appointment,
} from "../../src/actors/appointment-actor";

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

function createActor(): {
  actor: AppointmentActor;
  storage: ReturnType<typeof createMockStorage>;
} {
  const storage = createMockStorage();
  const actor = Object.create(AppointmentActor.prototype) as AppointmentActor;
  (actor as unknown as { ctx: unknown }).ctx = { storage };
  return { actor, storage };
}

describe("AppointmentActor", () => {
  describe("createAppointment", () => {
    it("successfully creates an appointment in a free slot", async () => {
      const { actor, storage } = createActor();

      const result = await actor.createAppointment("2026-01-15", "10:00");

      expect(result.success).toBe(true);
      expect(result.appointment).toBeDefined();
      expect(result.appointment!.date).toBe("2026-01-15");
      expect(result.appointment!.start_time).toBe("10:00");
      expect(result.appointment!.end_time).toBe("10:30");
      expect(result.appointment!.id).toMatch(/^appt_/);

      const stored = storage._store.get("appointments") as Appointment[];
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(result.appointment!.id);
    });

    it("detects a conflict when the same slot is already booked", async () => {
      const { actor } = createActor();

      await actor.createAppointment("2026-01-15", "10:00");
      const result = await actor.createAppointment("2026-01-15", "10:00");

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it("detects overlap with a partially overlapping slot", async () => {
      const { actor } = createActor();

      await actor.createAppointment("2026-01-15", "10:00");
      const result = await actor.createAppointment("2026-01-15", "10:15");

      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
      expect(result.conflicts).toHaveLength(1);
    });

    it("rejects a slot outside 9 AM - 5 PM", async () => {
      const { actor } = createActor();

      const tooEarly = await actor.createAppointment("2026-01-15", "08:00");
      expect(tooEarly.success).toBe(false);
      expect(tooEarly.error).toContain("09:00");

      const tooLate = await actor.createAppointment("2026-01-15", "17:00");
      expect(tooLate.success).toBe(false);
      expect(tooLate.error).toContain("17:00");
    });

    it("accepts the last valid slot (16:30, ending at 17:00)", async () => {
      const { actor } = createActor();

      const result = await actor.createAppointment("2026-01-15", "16:30");
      expect(result.success).toBe(true);
      expect(result.appointment!.end_time).toBe("17:00");
    });

    it("does not conflict with appointments on a different date", async () => {
      const { actor } = createActor();

      await actor.createAppointment("2026-01-15", "10:00");
      const result = await actor.createAppointment("2026-01-16", "10:00");

      expect(result.success).toBe(true);
    });

    it("generates suggestions excluding already-booked slots", async () => {
      const { actor } = createActor();

      await actor.createAppointment("2026-01-15", "09:00");
      await actor.createAppointment("2026-01-15", "10:00");
      const result = await actor.createAppointment("2026-01-15", "09:00");

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!).not.toContain("09:00 - 09:30");
      expect(result.suggestions!).not.toContain("10:00 - 10:30");
      expect(result.suggestions!).toContain("09:30 - 10:00");
    });
  });

  describe("listAppointments", () => {
    it("returns an empty array when no appointments exist", async () => {
      const { actor } = createActor();
      const list = await actor.listAppointments();
      expect(list).toEqual([]);
    });

    it("returns all stored appointments", async () => {
      const { actor } = createActor();
      await actor.createAppointment("2026-01-15", "09:00");
      await actor.createAppointment("2026-01-15", "11:00");
      await actor.createAppointment("2026-01-16", "14:00");

      const list = await actor.listAppointments();
      expect(list).toHaveLength(3);
    });
  });

  describe("cancelByTime", () => {
    it("cancels an appointment matching the date and start time", async () => {
      const { actor } = createActor();
      const created = await actor.createAppointment("2026-01-15", "10:00");
      expect(created.success).toBe(true);

      const result = await actor.cancelByTime("2026-01-15", "10:00");

      expect(result.cancelled).toBeDefined();
      expect(result.cancelled!.id).toBe(created.appointment!.id);

      const remaining = await actor.listAppointments();
      expect(remaining).toHaveLength(0);
    });

    it("returns not_found when no appointment matches", async () => {
      const { actor } = createActor();

      const result = await actor.cancelByTime("2026-01-15", "10:00");

      expect(result.not_found).toBe(true);
      expect(result.message).toContain("2026-01-15");
      expect(result.message).toContain("10:00");
    });

    it("does not cancel an appointment on a different date with same time", async () => {
      const { actor } = createActor();
      await actor.createAppointment("2026-01-15", "10:00");

      const result = await actor.cancelByTime("2026-01-16", "10:00");

      expect(result.not_found).toBe(true);
      const remaining = await actor.listAppointments();
      expect(remaining).toHaveLength(1);
    });
  });

  describe("cancelById", () => {
    it("cancels an appointment matching the ID", async () => {
      const { actor } = createActor();
      const created = await actor.createAppointment("2026-01-15", "10:00");
      expect(created.success).toBe(true);

      const result = await actor.cancelById(created.appointment!.id);

      expect(result.cancelled).toBeDefined();
      expect(result.cancelled!.id).toBe(created.appointment!.id);
    });

    it("returns not_found for a non-existent ID", async () => {
      const { actor } = createActor();

      const result = await actor.cancelById("appt_nonexistent");

      expect(result.not_found).toBe(true);
      expect(result.message).toContain("appt_nonexistent");
    });
  });

  describe("read-modify-write guarantee", () => {
    it("two sequential createAppointments for the same slot: only one succeeds", async () => {
      const { actor } = createActor();

      const first = await actor.createAppointment("2026-01-15", "10:00");
      const second = await actor.createAppointment("2026-01-15", "10:00");

      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      expect(second.conflict).toBe(true);

      const list = await actor.listAppointments();
      expect(list).toHaveLength(1);
    });
  });
});
