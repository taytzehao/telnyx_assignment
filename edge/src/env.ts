import type {
  KvNamespace,
  ActorNamespace,
  ActorStub,
} from "@telnyx/edge-runtime";
import type { CallSession } from "./actors/call-session";
import type {
  AppointmentActor,
  CreateResult,
  CancelResult,
  Appointment,
} from "./actors/appointment-actor";

type TelnyxClient = Record<string, unknown>;

type CallSessionStub = ActorStub &
  Pick<CallSession, "recordCall" | "getState">;

interface CallSessionNamespace extends ActorNamespace {
  idFromName(name: string): CallSessionStub;
}

type AppointmentSessionStub = ActorStub &
  Pick<
    AppointmentActor,
    "createAppointment" | "listAppointments" | "cancelByTime" | "cancelById"
  >;

interface AppointmentSessionNamespace extends ActorNamespace {
  idFromName(name: string): AppointmentSessionStub;
}

export interface Env {
  MY_TELNYX: TelnyxClient;
  SESSIONS: KvNamespace;
  CALL_SESSIONS: CallSessionNamespace;
  APPOINTMENT_SESSIONS: AppointmentSessionNamespace;
}

export type {
  Appointment,
  CreateResult,
  CancelResult,
  AppointmentActor,
};
