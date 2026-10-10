# Tasks

## 1. Dependencies & Bindings

- [x] 1.1 Add `@modelcontextprotocol/sdk` to `edge/package.json` dependencies and verify `npm install` in `edge/` succeeds (lockfile updates, no resolution errors)
- [x] 1.2 Add the `APPOINTMENT_SESSIONS` actor binding (`type = "AppointmentActor"`) to `edge/telnyx.toml` alongside the existing `CALL_SESSIONS` binding; verify the file parses by running `telnyx-edge` (or noting config parses with no schema error on next `telnyx-edge types`/`ship`)
- [x] 1.3 Update `edge/src/env.ts` to declare the `AppointmentActor` type and the `APPOINTMENT_SESSIONS` `ActorNamespace` (with `idFromName` returning a stub exposing `createAppointment`, `listAppointments`, `cancelByTime`, `cancelById`); verify `npm run typecheck` from `edge/` passes

## 2. AppointmentActor

- [x] 2.1 Implement `AppointmentActor` in `edge/src/actors/appointment-actor.ts` keyed by caller number: storage holds an `Appointment[]` of `{ id, date, start_time, end_time }`. Methods: `createAppointment(date, start_time)` returns `{ success, appointment }` or `{ conflict, conflicts, suggestions }`; `listAppointments()` returns the array; `cancelByTime(date, start_time)` and `cancelById(id)` each return `{ cancelled }` or `{ not_found }`. Reject slots outside 9 AM–5 PM. Suggestion generator computes the next free 30-min slots in range in-memory.
- [x] 2.2 Write `edge/tests/appointment-actor.test.ts` covering: successful create, conflict detected, slot outside 9 AM–5 PM range, cancel by specific time, cancel by appointment ID, no-match cancellation, list with zero and with multiple appointments
- [x] 2.3 Add a test in the same file for the read-modify-write guarantee: enqueue two `createAppointment` calls for the same slot on the same actor instance and assert only one succeeds (the second sees the conflict)
- [x] 2.4 Verify `npm run test` from `edge/` passes with all AppointmentActor tests green
- [x] 2.5 Re-export `AppointmentActor` from `edge/src/index.ts` (matching the existing `CallSession` pattern) so the class is bundled for the function; verify `npm run typecheck` still passes

## 3. FAQ Data & KV Helper

- [x] 3.1 Add a `edge/src/lib/faq.ts` module with default FAQ content for `hours`, `location`, `services`, `fees`, plus a `seedFaqs(kv)` helper that writes each to KV keys `faq:<category>` and a `getFaq(kv, category)` helper that reads from KV with fallback to the in-module defaults
- [x] 3.2 Write `edge/tests/faq.test.ts` covering: `getFaq` returns the KV value when present, falls back to defaults when missing, and unknown categories return a not-found signal
- [x] 3.3 Verify `npm run test` from `edge/` passes with FAQ tests green

## 4. MCP Server & Tool Handlers

- [x] 4.1 Implement the MCP SSE/HTTP transport endpoint at `/mcp` in `edge/src/index.ts` using `@modelcontextprotocol/sdk`; route `/mcp` POST requests to an in-function handler. Verify with a `curl` smoke test after deploying locally/dev that the endpoint returns the MCP initialize handshake. (Skip-spec full flow initially.)
- [x] 4.2 Implement `get_faq` in `edge/src/mcp/tools/get-faq.ts`: accepts `category`, calls `getFaq`, returns content, emits a structured log line with caller, tool name, outcome, and latency
- [x] 4.3 Implement `create_appointment` in `edge/src/mcp/tools/create-appointment.ts`: accepts `caller_number`, `date`, `start_time`; calls `AppointmentActor.createAppointment`; on conflict returns HTTP 409 (so `telnyx_last_tool_status_code` differs from 200) with conflict details + suggestions; on success returns HTTP 200 with the appointment. Logs structured entry.
- [x] 4.4 Implement `list_appointments` in `edge/src/mcp/tools/list-appointments.ts`: accepts `caller_number`; calls `AppointmentActor.listAppointments`; returns the array (HTTP 200). Logs structured entry.
- [x] 4.5 Implement `cancel_appointments` in `edge/src/mcp/tools/cancel-appointments.ts`: accepts `caller_number`, `cancel_by: "time" | "id"`, plus `date`/`start_time` or `appointment_id`; calls the matching actor method; returns cancelled details (HTTP 200) or not-found (HTTP 404). Logs structured entry.
- [x] 4.6 Write `edge/tests/mcp-tools.test.ts` with mocked `Env` (fake KV + actor stubs) covering: `get_faq` returns content for each category; `create_appointment` returns 200 on success and 409 with suggestions on conflict; `list_appointments` returns the actor's list; `cancel_appointments` returns the cancelled appointment and 404 on no match. Assert each handler emits a JSON log entry with caller, tool, outcome, latency.
- [x] 4.7 Verify `npm run test`, `npm run typecheck`, and `npm run lint` from `edge/` all pass with the MCP tool tests green

## 5. Dynamic Webhook Extensions

- [x] 5.1 Review `edge/src/webhook.ts` against the spec's `Dynamic webhook variables` requirement; confirm it returns `greeting`, `is_returning_caller`, `escalation_enabled`, and `caller_number`, and that `escalation_enabled` comes from the `flag:escalation_enabled` KV flag. Add any missing fields and a comment that the greeting is interpolated verbatim by the speak node
- [x] 5.2 Add `edge/tests/webhook.test.ts` (or extend the existing tests) covering: first-time caller gets the welcome greeting and `is_returning_caller=false`; returning caller gets the welcome-back greeting and `is_returning_caller=true`; `escalation_enabled` reflects the KV flag value
- [x] 5.3 Verify `npm run test` from `edge/` passes with webhook tests green

## 6. Conversation Workflow Definition & Deployment

- [x] 6.1 Author the 19-node `conversation_flow` JSON as `assistant/conversation-flow.json` (or under `edge/` if preferred by repo convention) with all node IDs, names, types, instructions (prompt), messages (speak), `shared_tool_id` references (tool), and `instructions_mode` set. Cross-check node count against design (2 speak, 13 prompt, 4 tool).
- [x] 6.2 Author the 28 edges in the same `conversation-flow.json` with LLM-condition prompts, the two variable-comparison expressions (`telnyx_last_tool_status_code == "200"` on Create and Cancel tool nodes), and the mandatory default edges on speak/tool nodes. Cross-check edge count against design.
- [x] 6.3 Write a deployment script (`scripts/deploy-assistant.ts` or extend `scripts/deploy.ts`) that uses the Telnyx SDK to create/update the AI Assistant with the `conversation_flow` payload, register the four MCP tools as shared tools, point the `dynamic_variables_webhook_url` at the Edge Function URL, and assign (or report) a phone number. Read `TELNYX_API_KEY` from process env only.
- [x] 6.4 Document the assistant deployment steps in `README.md` (or a `docs/assistant-setup.md` section): how to set `TELNYX_API_KEY`, point the script at the Edge Function URL from `telnyx-edge ship`, run the script, and read back the assigned phone number. Verify the documented commands run as written.
- [x] 6.5 Run `scripts/deploy-assistant.ts` against the Telnyx sandbox/test account and verify the assistant's `conversation_flow` matches the file (GET the assistant back and diff the relevant fields)

## 7. Integration & Verification

- [x] 7.1 Run `npm run lint && npm run typecheck && npm run test` from `edge/` and confirm all pass with no warnings
- [x] 7.2 Deploy the Edge Function via `telnyx-edge ship` and confirm the live URL responds `ok` on `/health/liveness`
- [ ] 7.3 Dial the assigned phone number and walk the happy path: greeting (verbatim) → FAQ (hours) → "Anything Else?" → done → goodbye → hangup. Verify the call ends cleanly.
- [ ] 7.4 Walk the appointment flow end-to-end: appointment menu → collect details → verify create (confirm) → create tool → confirm booking → anything else → appointment menu → list → show → anything else → cancel → verify cancel (confirm) → cancel tool → confirm cancellation. Verify each transition fires as designed and the confirm gate catches an intentional correction (say "no, make it Tuesday") and routes back to collection.
- [ ] 7.5 Walk the escalation path: ask an out-of-scope question from the FAQ node, verify the bot informs the caller to call the human line, then speaks the verbatim goodbye and hangs up.
- [ ] 7.6 Walk the negative case: trigger the verification gate and provide feedback to change the details instead of confirming; verify the workflow routes back to the collection step with the caller's revised request rather than executing the destructive tool.
- [ ] 7.7 While running the integration calls, fetch the Edge Function logs and confirm every webhook call and every MCP tool call produces a structured JSON entry with caller, node/tool, outcome, and latency, and that tool latency stays well under the configured timeout
- [ ] 7.8 Add the observability story to `README.md`: how to detect within a minute that the assistant is broken (which log fields/metric to scan), and the trail for one thing that broke during development. This satisfies the challenge's observability documentation requirement.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
