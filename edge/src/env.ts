import type {
  KvNamespace,
  ActorNamespace,
  ActorStub,
} from "@telnyx/edge-runtime";
import type { CallSession } from "./actors/call-session";

/**
 * Minimal Telnyx SDK client type.
 *
 * After running `telnyx-edge types`, the generated `telnyx-env.d.ts`
 * will declare a precise global `Env` with the full Telnyx client.
 * This local interface provides types during development and testing
 * without requiring the CLI-generated file.
 */
type TelnyxClient = Record<string, unknown>;

type CallSessionStub = ActorStub &
  Pick<CallSession, "recordCall" | "getState">;

interface CallSessionNamespace extends ActorNamespace {
  idFromName(name: string): CallSessionStub;
}

export interface Env {
  MY_TELNYX: TelnyxClient;
  SESSIONS: KvNamespace;
  CALL_SESSIONS: CallSessionNamespace;
}
