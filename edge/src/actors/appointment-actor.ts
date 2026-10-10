import { StatefulActor } from "@telnyx/edge-runtime";

export interface Appointment {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
}

export interface CreateResult {
  success: boolean;
  appointment?: Appointment;
  conflict?: boolean;
  conflicts?: Appointment[];
  suggestions?: string[];
  error?: string;
}

export interface CancelResult {
  cancelled?: Appointment;
  not_found?: boolean;
  message?: string;
}

const SLOT_DURATION_MIN = 30;
const EARLIEST_SLOT_MIN = 9 * 60;
const LATEST_SLOT_START_MIN = 16 * 60 + 30;

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `appt_${Date.now()}_${idCounter}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isSlotInRange(startTime: string): boolean {
  const startMin = timeToMinutes(startTime);
  return startMin >= EARLIEST_SLOT_MIN && startMin <= LATEST_SLOT_START_MIN;
}

function slotsOverlap(a: Appointment, date: string, startMin: number): boolean {
  if (a.date !== date) return false;
  const aStart = timeToMinutes(a.start_time);
  const aEnd = timeToMinutes(a.end_time);
  return startMin < aEnd && startMin + SLOT_DURATION_MIN > aStart;
}

function generateSuggestions(appointments: Appointment[], date: string): string[] {
  const booked = appointments
    .filter((a) => a.date === date)
    .map((a) => ({
      start: timeToMinutes(a.start_time),
      end: timeToMinutes(a.end_time),
    }))
    .sort((a, b) => a.start - b.start);

  const suggestions: string[] = [];
  for (let slot = EARLIEST_SLOT_MIN; slot <= LATEST_SLOT_START_MIN; slot += SLOT_DURATION_MIN) {
    const slotEnd = slot + SLOT_DURATION_MIN;
    const hasConflict = booked.some((b) => slot < b.end && slotEnd > b.start);
    if (!hasConflict) {
      suggestions.push(`${minutesToTime(slot)} - ${minutesToTime(slotEnd)}`);
    }
    if (suggestions.length >= 5) break;
  }
  return suggestions;
}

export class AppointmentActor extends StatefulActor {
  async createAppointment(date: string, startTime: string): Promise<CreateResult> {
    if (!isSlotInRange(startTime)) {
      return {
        success: false,
        error: "Slots are only available between 09:00 and 17:00.",
      };
    }

    const appointments = (await this.ctx.storage.get<Appointment[]>("appointments")) ?? [];
    const startMin = timeToMinutes(startTime);

    const conflicts = appointments.filter((a) => slotsOverlap(a, date, startMin));
    if (conflicts.length > 0) {
      return {
        success: false,
        conflict: true,
        conflicts,
        suggestions: generateSuggestions(appointments, date),
      };
    }

    const appointment: Appointment = {
      id: generateId(),
      date,
      start_time: startTime,
      end_time: minutesToTime(startMin + SLOT_DURATION_MIN),
    };

    appointments.push(appointment);
    appointments.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.start_time.localeCompare(b.start_time);
    });
    await this.ctx.storage.put("appointments", appointments);

    return { success: true, appointment };
  }

  async listAppointments(): Promise<Appointment[]> {
    return (await this.ctx.storage.get<Appointment[]>("appointments")) ?? [];
  }

  async cancelByTime(date: string, startTime: string): Promise<CancelResult> {
    const appointments = (await this.ctx.storage.get<Appointment[]>("appointments")) ?? [];
    const idx = appointments.findIndex(
      (a) => a.date === date && a.start_time === startTime,
    );

    if (idx === -1) {
      return { not_found: true, message: `No appointment found on ${date} at ${startTime}.` };
    }

    const [cancelled] = appointments.splice(idx, 1);
    await this.ctx.storage.put("appointments", appointments);

    return { cancelled };
  }

  async cancelById(appointmentId: string): Promise<CancelResult> {
    const appointments = (await this.ctx.storage.get<Appointment[]>("appointments")) ?? [];
    const idx = appointments.findIndex((a) => a.id === appointmentId);

    if (idx === -1) {
      return { not_found: true, message: `No appointment found with ID ${appointmentId}.` };
    }

    const [cancelled] = appointments.splice(idx, 1);
    await this.ctx.storage.put("appointments", appointments);

    return { cancelled };
  }
}
