# Tasks

## 1. Type Extension & Scenario Module Skeleton

- [x] 1.1 Add `target_edge_ids?: string[]` to the `TestScenario` interface in `workflow/eval/types.ts`. Verify by running `npx tsc --noEmit` from repo root and confirming zero type errors.
- [x] 1.2 Create `workflow/eval/clinic-scenarios.ts` with the module skeleton: import `TestScenario` from `./types`, define three suite-name constants (`clinic-routing`, `clinic-appointment-lifecycle`, `clinic-edge-cases`), and an empty `allClinicScenarios: TestScenario[]` export (populated in later tasks). Verify by running `npx tsc --noEmit` and confirming the module compiles.

## 2. Clinic Routing Scenarios

- [x] 2.1 Add 4 intent-routing scenarios to `clinic-scenarios.ts`: `intentToFaq` (persona asks about clinic hours), `intentToAppt` (persona wants to book an appointment), `intentToEscalate` (persona asks for something the bot cannot handle), `intentToGoodbye` (persona says they do not need help). Each carries `test_suite: "clinic-routing"`, `telnyx_conversation_channel: "web_chat"`, a dual-criterion rubric (reach expected target node + did not reach nearest sibling), and `target_edge_ids` matching the edge ID in `assistant/conversation-flow.json` (e.g., `["e_intent_to_faq"]`). Verify by running `npx tsc --noEmit` and confirming the scenarios type-check against `TestScenario`.
- [x] 2.2 Add 4 appointment-menu-routing scenarios: `apptMenuToCreate` (persona wants to book), `apptMenuToList` (persona wants to see existing appointments), `apptMenuToCancel` (persona wants to cancel), `apptMenuToAnythingElse` (persona changes mind). Each with dual-criterion rubric and `target_edge_ids` (e.g., `["e_appt_menu_to_collect"]`). Verify by running `npx tsc --noEmit`.
- [x] 2.3 Add 3 verify-create-routing scenarios: `verifyCreateToCreate` (persona unqualifiedly confirms), `verifyCreateBackToCollect` (persona says "make it Tuesday instead"), `verifyCreateToAnythingElse` (persona says "forget it, I don't want to book"). Each with dual-criterion rubric and `target_edge_ids`. Verify by running `npx tsc --noEmit`.
- [x] 2.4 Add 3 verify-cancel-routing scenarios: `verifyCancelToCancel` (persona confirms cancellation), `verifyCancelBackToCollect` (persona wants to cancel a different one), `verifyCancelToAnythingElse` (persona abandons cancellation). Each with dual-criterion rubric and `target_edge_ids`. Verify by running `npx tsc --noEmit`.
- [x] 2.5 Add 2 anything-else-routing scenarios: `anythingElseToIntent` (persona says they need more help), `anythingElseToGoodbye` (persona says they are done). Each with dual-criterion rubric and `target_edge_ids`. Then update `allClinicScenarios` to include all 16 routing scenarios. Verify by running `npx tsc --noEmit` and confirming `allClinicScenarios.length === 16`.

## 3. Appointment Lifecycle Scenario

- [x] 3.1 Add the `appointmentLifecycle` scenario to `clinic-scenarios.ts` with `test_suite: "clinic-appointment-lifecycle"`, `telnyx_conversation_channel: "web_chat"`, `max_duration_seconds: 240`, and no `target_edge_ids`. The `instructions` field describes a caller persona that walks the full cycle in one conversation: asks to book "April 14, 2027 at 2 PM" → confirms when asked → asks to list appointments → asks to cancel the booking → confirms when asked → asks to list again. The `rubric` has 5 criteria: (a) appointment created with the requested date and time, (b) listing after creation shows the booking, (c) assistant asked for explicit confirmation before executing create, (d) appointment cancelled through the verification gate, (e) listing after cancellation does not show the booking. Verify by running `npx tsc --noEmit` and confirming the scenario type-checks.
- [x] 3.2 Add `appointmentLifecycle` to `allClinicScenarios`. Verify by running `npx tsc --noEmit` and confirming `allClinicScenarios.length === 17`.

## 4. Clinic Edge Case Scenarios

- [x] 4.1 Add 3 edge-case scenarios to `clinic-scenarios.ts` with `test_suite: "clinic-edge-cases"` and `telnyx_conversation_channel: "web_chat"`: `outOfHoursRejected` (persona requests a 7 AM appointment; rubric asserts the assistant informs slots are 9 AM–5 PM and does not proceed to verify create), `faqOutOfScopeEscalation` (persona asks about insurance; rubric asserts escalation to human line and no attempt to answer), `conflictAcceptAlternative` (persona books a slot, re-books the same slot, accepts a suggested alternative; `max_duration_seconds: 240`; rubric asserts alternatives presented and booking completed at the accepted alternative). Verify by running `npx tsc --noEmit`.
- [x] 4.2 Add 3 more edge-case scenarios with `test_suite: "clinic-edge-cases"`: `midCollectionAbandon` (persona says "never mind, forget it" while the assistant collects appointment details; rubric asserts the assistant returns to the post-action checkpoint or main menu and does not proceed to verify create), `explicitHumanRequest` (persona says "let me talk to a person" at the intent step; rubric asserts escalation to human line), `anythingElseLoopTwice` (persona walks intent → FAQ → anything_else → intent → FAQ → anything_else → done; `max_duration_seconds: 240`; rubric asserts the assistant handles the loop-back correctly and eventually reaches goodbye). Verify by running `npx tsc --noEmit`.
- [x] 4.3 Add all 6 edge-case scenarios to `allClinicScenarios`. Verify by running `npx tsc --noEmit` and confirming `allClinicScenarios.length === 23`.

## 5. Coverage Guardrail & Scenario Validation Tests

- [x] 5.1 Add a coverage-guardrail test to `workflow/eval/eval.test.ts` that reads `assistant/conversation-flow.json`, collects all edge IDs where `condition.type === "llm"` AND the edge's `start_node_id` is one of the 5 high-value branching nodes (`n_intent`, `n_appt_menu`, `n_verify_create`, `n_verify_cancel`, `n_anything_else`), collects all `target_edge_ids` from every scenario in `allClinicScenarios`, and asserts every high-value LLM edge ID appears in at least one scenario's `target_edge_ids`. The test SHALL list any uncovered edge IDs in its failure message. Verify by running `npx tsx workflow/eval/eval.test.ts` and confirming the guardrail passes (all 16 high-value LLM edges covered).
- [x] 5.2 Add a scenario-shape validation test to `workflow/eval/eval.test.ts` that iterates over every scenario in `allClinicScenarios` and asserts: `name` is non-empty, `instructions` is non-empty, `rubric` has at least one item with non-empty `name` and `criteria`, `telnyx_conversation_channel` is one of `web_chat` | `phone_call` | `web_call` | `sms_chat`, and `test_suite` is non-empty. Scenarios with `target_edge_ids` SHALL have at least one entry. Verify by running `npx tsx workflow/eval/eval.test.ts` and confirming all shape assertions pass.
- [x] 5.3 Verify the existing boilerplate tests (EvalClient constructor, EvalRunner cache/recreate tests, boilerplate scenario structure) still pass by running `npx tsx workflow/eval/eval.test.ts` and confirming all tests pass with no regressions.

## 6. CLI Extension

- [x] 6.1 Add a `parseArgs` helper to `workflow/eval/run-eval.ts` that scans `process.argv` for `--suite <value>` and `--scenario <value>` flags and returns `{ suite?: string; scenario?: string }`. Verify by running `npx tsc --noEmit`.
- [x] 6.2 Import `allClinicScenarios` and `handleRequestScenario` into `run-eval.ts`. Implement scenario selection: if `--scenario` is set, filter to the exact `name` match; else if `--suite` is set, filter by `test_suite`; else select all (boilerplate + all clinic). Inject the resolved `destination` into each selected scenario. Print which scenarios are selected before execution. Verify by running `npx tsc --noEmit`.
- [x] 6.3 Add multi-scenario iteration to `run-eval.ts`: loop sequentially over selected scenarios calling `EvalRunner.run(scenario)` for each, collecting `{ scenarioName, testRun }` results into an array. After all scenarios complete, print a summary matrix showing each scenario name, each rubric criterion name, and its pass/fail status, followed by a total pass/fail count. Exit non-zero if any criterion failed or any run errored. Verify by running `npx tsc --noEmit`.
- [x] 6.4 Verify the missing-configuration error path still works: run `npx tsx workflow/eval/run-eval.ts` without `TELNYX_API_KEY` or `ASSISTANT_DESTINATION` set and confirm it prints a clear error and exits with code 1. Verify the `--suite` flag narrows selection: run `npx tsx workflow/eval/run-eval.ts --suite clinic-routing` and confirm the console output lists only the 16 `clinic-routing` scenarios before execution begins (use a dry-run or mock to avoid making real API calls if the assistant is not deployed).

## 7. Documentation

- [x] 7.1 Add a "Running the Clinic Evals" section to `README.md` documenting: the three test suites (`clinic-routing`, `clinic-appointment-lifecycle`, `clinic-edge-cases`) and what each covers; the `--suite <name>` and `--scenario <name>` flags with examples; expected runtime (~6 min full, ~1 min per routing suite, ~4 min lifecycle suite); the prerequisite of `TELNYX_API_KEY` and `ASSISTANT_DESTINATION`; and the coverage guardrail test that catches workflow drift. Verify by reading the README and confirming the section covers all three suites, both CLI flags, runtime expectations, prerequisites, and the guardrail concept.

## 8. Integration Verification

- [x] 8.1 Run `npx tsc --noEmit` from the repo root and confirm zero type errors across `workflow/eval/**/*.ts`.
- [x] 8.2 Run `npx tsx workflow/eval/eval.test.ts` and confirm all unit tests pass (existing boilerplate tests + coverage guardrail + scenario shape validation).
- [x] 8.3 Verify the full set of new and modified files: `workflow/eval/clinic-scenarios.ts` (new, 23 scenarios), `workflow/eval/types.ts` (`target_edge_ids` field added), `workflow/eval/run-eval.ts` (CLI flags + multi-scenario iteration + summary matrix), `workflow/eval/eval.test.ts` (coverage guardrail + shape validation tests added), `README.md` (clinic eval section added).
- [x] 8.4 Run `npm run eval -- --suite clinic-routing` against the deployed assistant and confirm each of the 16 scenarios runs, the summary matrix prints per-criterion results, and all high-value LLM edges are covered. Document any routing failures as separate findings for follow-up.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
