# Proposal

## Why

The project has a deployed AI Assistant with a multi-step conversation workflow, but no automated way to evaluate whether the workflow routes callers correctly. The challenge requires testing every workflow path (happy, fallback, escalation, negative). The Telnyx platform provides a built-in Assistant Tests API (`/ai/assistants/tests`) that defines test agents as caller personas and evaluators as rubric criteria — this change scaffolds the boilerplate to use that API, starting with one example scenario that exercises the happy-path routing edge.

## What Changes

- New `workflow/eval/` folder containing the evaluation harness:
  - `types.ts` — TypeScript types for test configs, rubric items, run responses, and cached test IDs (re-exports SDK types where available).
  - `scenarios.ts` — One boilerplate test scenario (`TestScenario`) targeting the `n_identify_intent → n_handle` LLM-condition edge, with a caller-persona `instructions` field (test agent) and two routing-correctness `rubric` items (evaluator).
  - `client.ts` — Thin wrapper over the `telnyx` SDK for the Assistant Tests API: `tests.create`, `tests.retrieve`, `tests.update`, `tests.delete`, `tests.runs.trigger`, `tests.runs.retrieve`.
  - `runner.ts` — Orchestration logic: checks for a cached test ID, creates the test config if absent, triggers a run, polls until terminal status, and reports per-rubric pass/fail. Implements recreate-on-error: if a cached test ID returns 404 on run trigger, the runner recreates the test and updates the cache.
  - `run-eval.ts` — CLI entry point that loads scenarios, runs the eval, and prints results.
  - `eval.test.ts` — Unit tests for the client wrapper (constructor, env-key handling) and runner logic (cache hit, cache miss, recreate-on-404).
- New `.telnyx/eval-tests.json` cache file (gitignored) storing `{ scenario_name: test_id }` so repeated runs reuse existing test configs instead of creating duplicates.
- Updated root `package.json` — adds `"eval": "tsx --env-file-if-exists=.env workflow/eval/run-eval.ts"` script.
- Updated root `tsconfig.json` — `workflow/**/*.ts` is already in `include`; no change needed.
- Updated `.gitignore` — adds `.telnyx/eval-tests.json`.

## Capabilities

### New Capabilities

- `workflow-eval`: Automated evaluation of the AI Assistant's conversation workflow using the Telnyx Assistant Tests API. Covers test-agent scenario definitions (caller personas), evaluator rubric criteria (routing correctness), test-config caching for idempotent re-runs, and run orchestration with polling and result reporting.

### Modified Capabilities

(None — no existing specs in the project.)

## Impact

- **New code**: `workflow/eval/` folder (6 files).
- **New dependency**: None — reuses the existing `telnyx` SDK (^7.25.0) already in root `package.json`.
- **APIs**: The eval client calls `POST /ai/assistants/tests` (create), `POST /ai/assistants/tests/{test_id}/runs` (trigger), and `GET /ai/assistants/tests/{test_id}/runs/{run_id}` (poll).
- **Runtime behavior**: `npm run eval` triggers a real test conversation against the deployed assistant via the Telnyx Tests API. Requires `TELNYX_API_KEY` and the assistant to be deployed (test `destination` field points to the assistant's phone number or web chat endpoint).
- **No breaking changes** — purely additive; existing workflow, edge, and deploy code are untouched.
