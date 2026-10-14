# Tasks

## 1. Project Setup

- [x] 1.1 Add `"eval": "tsx --env-file-if-exists=.env workflow/eval/run-eval.ts"` to the `scripts` section of root `package.json`. Verify by running `npm run eval --help` (or `npx tsx workflow/eval/run-eval.ts` before the script is wired) and confirming the script resolves without a "script not found" error — a runtime error about missing files is expected at this stage and confirms the script entry exists.
- [x] 1.2 Add `.telnyx/eval-tests.json` to `.gitignore`. Verify by running `git status` and confirming the entry is present in the ignored files and the file itself (if created) does not appear as untracked.

## 2. Eval Types

- [x] 2.1 Inspect the installed `telnyx` SDK's exports to determine whether `client.ai.assistants.tests.*` methods exist and what types they expose (`CreateAssistantTestRequest`, `AssistantTestResponse`, `TriggerTestRunRequest`, `TestRunResponse`, `TestStatus`, `TelnyxConversationChannel`). Record findings as a code comment at the top of `workflow/eval/types.ts`. Verify by running `npx tsc --noEmit` and confirming the module compiles.
- [x] 2.2 Create `workflow/eval/types.ts` with TypeScript types: `TestScenario` (name, instructions, rubric, destination, telnyx_conversation_channel, test_suite, optional max_duration_seconds), `RubricItem` (name, criteria), `TestRunStatus` (pending/starting/running/passed/failed/error), `TestRunDetailResult` (name, status), `TestRunResult` (run_id, test_id, status, detail_status[], triggered_by, created_at), `TestCache` (`Record<string, string>` mapping scenario name to test_id). Re-export SDK types where available; define structural types for SDK gaps. Verify by running `npx tsc --noEmit` and confirming no type errors.

## 3. Test Scenario Definition

- [x] 3.1 Create `workflow/eval/scenarios.ts` exporting one boilerplate `TestScenario` object: `name: "Routing: Handle Request"`, `instructions: "You are a caller who needs help with a billing question. Ask clearly and stay on topic. Do not request escalation."`, `rubric` with two items — `{ name: "Route to Handle", criteria: "The conversation reaches the Handle Request node rather than the Escalate node" }` and `{ name: "No Premature Escalation", criteria: "The assistant does not escalate to a human without justification" }`, `telnyx_conversation_channel: "web_chat"`, `test_suite: "workflow-routing"`, `destination: ""` (filled at runtime from env or `.telnyx/assistant.json`). Verify by running `npx tsc --noEmit` and confirming the module compiles against the `TestScenario` type.

## 4. Eval Client

- [x] 4.1 Create `workflow/eval/client.ts` with an `EvalClient` class that wraps the `telnyx` SDK. Constructor reads `TELNYX_API_KEY` from `process.env` (or accepts an explicit key) and throws if unset — same pattern as `workflow/client.ts`. Methods: `createTest(scenario)` calls the SDK's tests create method with an idempotency key, `triggerRun(test_id)` calls the SDK's runs trigger method, `getRun(test_id, run_id)` calls the SDK's runs retrieve method. If the SDK lacks `tests.*` methods, fall back to raw `fetch` against `/ai/assistants/tests` endpoints with the Bearer key. Verify by running `npx tsc --noEmit` and confirming the module compiles.
- [x] 4.2 Write unit tests for `EvalClient` in `workflow/eval/eval.test.ts`: constructor succeeds when apiKey is provided explicitly, constructor reads `TELNYX_API_KEY` from env, constructor throws when key is unset. Follow the test pattern established in `workflow/client.test.ts` (inline assertions with tsx, no test framework dependency). Verify by running `npx tsx workflow/eval/eval.test.ts` and confirming all client tests pass.

## 5. Eval Runner

- [x] 5.1 Create `workflow/eval/runner.ts` with an `EvalRunner` class. Constructor accepts an `EvalClient` instance, a cache file path (default `.telnyx/eval-tests.json`), poll interval (default 5000ms), and timeout (default 120000ms). Methods: `run(scenario)` — reads the cache for the scenario name; if a `test_id` is cached, calls `client.triggerRun(test_id)`; if no cache, calls `client.createTest(scenario)`, writes the returned `test_id` to the cache, then triggers a run. After triggering, polls `client.getRun(test_id, run_id)` at the configured interval until the status is terminal (`passed`, `failed`, or `error`) or timeout is exceeded. Returns a `TestRunResult`. Verify by running `npx tsc --noEmit` and confirming the module compiles.
- [x] 5.2 Implement the recreate-on-error path: if `client.triggerRun(cached_test_id)` throws an error indicating 404 (test not found), the runner calls `client.createTest(scenario)`, updates the cache file with the new `test_id`, and triggers a run against the new ID. Verify by running `npx tsc --noEmit` and confirming the module compiles.
- [x] 5.3 Write unit tests for the runner in `workflow/eval/eval.test.ts` (extending the file from task 4.2): cache miss creates and caches the test ID (mock `EvalClient.createTest` to return a test_id, assert cache file written), cache hit skips creation and triggers directly (mock `EvalClient.triggerRun`, assert `createTest` not called), recreate-on-404 creates a new test and updates the cache (mock `triggerRun` to throw a 404 error on first call, assert `createTest` called and cache updated). Verify by running `npx tsx workflow/eval/eval.test.ts` and confirming all runner tests pass.

## 6. CLI Entry Point

- [x] 6.1 Create `workflow/eval/run-eval.ts` as the CLI entry point. It reads the `destination` from `ASSISTANT_DESTINATION` in `process.env` or `.telnyx/assistant.json` (if the latter exists), validates it is non-empty (prints a clear error and exits non-zero if missing), injects it into the boilerplate scenario, constructs an `EvalClient` and `EvalRunner`, calls `runner.run(scenario)`, prints each rubric criterion's name and pass/fail status from `detail_status`, and exits non-zero if any criterion failed or the run errored. Verify by running `npx tsc --noEmit` and confirming the script compiles.
- [x] 6.2 Verify the missing-configuration error path: run `npx tsx workflow/eval/run-eval.ts` without `TELNYX_API_KEY` or `ASSISTANT_DESTINATION` set and confirm it prints a clear error message and exits with code 1.

## 7. Integration Verification

- [x] 7.1 Run `npx tsc --noEmit` from the repo root and confirm zero type errors across `workflow/eval/**/*.ts`.
- [x] 7.2 Run `npx tsx workflow/eval/eval.test.ts` and confirm all unit tests pass (client constructor tests + runner cache/recreate tests).
- [x] 7.3 Verify the full set of new files exists: `workflow/eval/types.ts`, `workflow/eval/scenarios.ts`, `workflow/eval/client.ts`, `workflow/eval/runner.ts`, `workflow/eval/run-eval.ts`, `workflow/eval/eval.test.ts`. Verify the updated files contain the expected changes: `package.json` (`eval` script), `.gitignore` (`.telnyx/eval-tests.json`).
