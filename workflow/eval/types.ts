/*
 * SDK type inspection findings (task 2.1):
 *
 * The `telnyx` SDK (^7.25.0) exposes the Assistant Tests API under
 * `client.ai.assistants.tests.*` — confirmed in
 * `node_modules/telnyx/resources/ai/assistants/tests/tests.d.ts`:
 *
 * Methods (on `client.ai.assistants.tests`):
 *   create(params: TestCreateParams, options?: RequestOptions) → AssistantTest
 *   retrieve(testID: string, options?: RequestOptions) → AssistantTest
 *   update(testID: string, body: TestUpdateParams, options?) → AssistantTest
 *   delete(testID: string, options?: RequestOptions) → void
 *   list(query?: TestListParams, options?) → PagePromise<…, AssistantTest>
 *
 * Methods (on `client.ai.assistants.tests.runs`):
 *   trigger(testID: string, params?: RunTriggerParams, options?) → TestRunResponse
 *   retrieve(runID: string, params: RunRetrieveParams, options?) → TestRunResponse
 *   list(testID: string, query?: RunListParams, options?) → PagePromise<…, TestRunResponse>
 *
 * RequestOptions (from `telnyx`) has `idempotencyKey?: string` — same pattern
 * as the existing assistant client in `workflow/client.ts`.
 *
 * Key exported types (from `telnyx/resources/ai/assistants/tests`):
 *   TestCreateParams          — create request body (required: name, destination, instructions, rubric)
 *   TestUpdateParams          — update request body (all optional)
 *   AssistantTest             — the test response object (test_id, name, rubric, created_at, …)
 *   TestRunResponse           — run execution response (run_id, test_id, status, detail_status?, …)
 *   TestRunDetailResult       — per-criterion result ({ name, status })
 *   TestStatus                — 'pending' | 'starting' | 'running' | 'passed' | 'failed' | 'error'
 *   TelnyxConversationChannel — 'phone_call' | 'web_call' | 'sms_chat' | 'web_chat'
 *   RunTriggerParams          — { destination_version_id?, 'Idempotency-Key'? }
 *   RunRetrieveParams         — { test_id: string }
 *
 * Field naming: all snake_case (matches the API wire format).
 *
 * The SDK's TestCreateParams includes an 'Idempotency-Key' header param, but
 * we use RequestOptions.idempotencyKey instead (matching workflow/client.ts).
 */

// Re-export SDK types — no duplication
export type {
  TestCreateParams,
  TestUpdateParams,
  AssistantTest,
  TestRunResponse as TestRunResult,
  TestRunDetailResult,
  TestStatus as TestRunStatus,
  TelnyxConversationChannel,
  RunTriggerParams,
  RunRetrieveParams,
} from "telnyx/resources/ai/assistants/tests";

import type {
  TestCreateParams,
} from "telnyx/resources/ai/assistants/tests";

// Our own types — not in the SDK

export interface RubricItem {
  name: string;
  criteria: string;
}

/** An appointment that must exist for the test caller before a run starts. */
export interface SeedAppointment {
  /** YYYY-MM-DD — must be a future date. */
  date: string;
  /** HH:MM, 24-hour, on a 30-minute slot between 09:00 and 16:30. */
  start_time: string;
}

export interface TestScenario {
  name: string;
  instructions: string;
  rubric: RubricItem[];
  destination: string;
  telnyx_conversation_channel: TestCreateParams["telnyx_conversation_channel"];
  test_suite: string;
  max_duration_seconds?: number;
  target_edge_ids?: string[];
  /**
   * Appointments the scenario's caller already has. Each test runs as its own
   * caller (`ai-assistant-test-<test_id>`), so the runner clears that caller's
   * appointments and creates these before every run.
   */
  seed_appointments?: SeedAppointment[];
}

export type TestCache = Record<string, string>;
