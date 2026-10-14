# Design

## Context

The `add-workflow-eval-boilerplate` change built the eval harness (`workflow/eval/`) wrapping the Telnyx Assistant Tests API: `TestScenario` type, `EvalClient` (SDK wrapper), `EvalRunner` (cache + poll + recreate-on-404), and a `run-eval.ts` CLI that runs a single boilerplate scenario (`handleRequestScenario`). The `TestScenario` type carries `name`, `instructions` (caller persona), `rubric` (evaluator criteria), `destination`, `telnyx_conversation_channel`, `test_suite`, and optional `max_duration_seconds`.

The clinic conversation workflow (`assistant/conversation-flow.json`) defines 19 nodes and 35 edges. Of those edges, the high-value LLM-conditioned routing edges (where the model decides which branch to take based on caller utterance) number 16, concentrated at five branching nodes: `n_intent` (4 LLM edges + 1 expression timeout), `n_appt_menu` (4 LLM), `n_verify_create` (3 LLM), `n_verify_cancel` (3 LLM), and `n_anything_else` (2 LLM). The remaining edges are either deterministic (`default` on speak/tool nodes) or single-path confirmation transitions.

The existing `run-eval.ts` reads `destination` from `ASSISTANT_DESTINATION` env or `.telnyx/assistant.json`, then runs a single scenario. It does not iterate over multiple scenarios or accept filter flags.

## Goals / Non-Goals

**Goals:**
- Provide scenario coverage for every high-value LLM-conditioned routing edge in the clinic workflow, the appointment create-list-cancel lifecycle, and six adversarial edge cases.
- Make the coverage auditable: a static guardrail test fails if a new LLM-conditioned edge is added without a corresponding scenario.
- Let the user cheaply run a subset (one suite, one scenario) for fast feedback, and run all scenarios for full regression.
- Keep the harness additive — don't change the existing boilerplate scenario or break `npm run eval`.

**Non-Goals:**
- Testing the expression-condition timeout edge (`telnyx_conversation_duration_secs >= 600`) — requires a 10+ minute conversation, not practical for web_chat evals.
- Testing every deterministic `default`-condition edge (speak → next, goodbye → hangup) — these fire unconditionally and are tested by every scenario that reaches them.
- CI/CD pipeline integration — evals run on demand via CLI; wiring into CI is a future concern.
- Custom caller simulation or LLM-as-judge scoring — all simulation and evaluation is delegated to the Telnyx Tests API.

## Decisions

### D1: Single scenarios file, not one per suite

**Decision:** All 23 clinic scenarios live in one `workflow/eval/clinic-scenarios.ts` file, exported as named constants grouped by test suite via comments.

**Rationale:** The scenarios are plain data objects with no logic. A single file makes it easy to scan the full coverage at a glance, and the coverage guardrail test needs to import all of them in one statement. Splitting per suite would add import boilerplate without organizational benefit at 23 objects.

**Alternatives considered:** One file per suite (`routing-scenarios.ts`, `lifecycle-scenarios.ts`, `edge-case-scenarios.ts`) — more navigable if scenarios grow to 100+, but premature for 23.

### D2: Dual-criterion rubric — reach target + avoid sibling

**Decision:** Each routing scenario's `rubric` array contains exactly two items: (a) "The conversation reached node X" and (b) "The conversation did not reach node Y" where Y is the nearest sibling that would indicate a mis-route.

**Rationale:** A single positive criterion ("reached X") would miss the case where the conversation touched both X and Y before settling — the model might visit the wrong node and then correct. The negative criterion ("did not reach Y") catches silent mis-routes that the positive criterion alone would miss. The Telnyx rubric evaluator checks each criterion independently against the transcript, so two criteria produce two distinct pass/fail signals.

**Alternatives considered:** Single positive criterion only — too weak. Three+ criteria (reach X, avoid Y, avoid Z) — over-constrains the evaluator for edges with three+ siblings; two is the minimum that catches the most likely mis-route.

### D3: `target_edge_ids` on `TestScenario`, not a separate coverage manifest

**Decision:** Add `target_edge_ids?: string[]` directly to the `TestScenario` interface in `types.ts`. The coverage guardrail test collects all `target_edge_ids` from all scenario objects and compares against the LLM-conditioned edge IDs in `conversation-flow.json`.

**Rationale:** Co-locating the edge mapping on the scenario means the developer sees which edge they're covering when they read the scenario. A separate coverage manifest file would drift from the scenarios. The guardrail test is the enforcement mechanism; the field is the declaration.

**Alternatives considered:** A separate `coverage-map.json` — adds a file to maintain and sync. Naming edges in the scenario `name` string — not machine-readable.

### D4: Manual `process.argv` parsing, no CLI library

**Decision:** `run-eval.ts` parses `--suite` and `--scenario` via a small inline `parseArgs` helper scanning `process.argv`. No `commander`, `yargs`, or `minimist` dependency.

**Rationale:** Two flags with string values is trivially parseable in 10 lines. Adding a CLI library for this is over-engineering. The existing `run-eval.ts` has no CLI parsing at all, so this is the first flag-handling code.

**Alternatives considered:** Node's built-in `util.parseArgs` — available in Node 18.3+, viable but the inline version is more explicit and doesn't depend on the runtime version.

### D5: Coverage guardrail as a unit test in `eval.test.ts`

**Decision:** The coverage guardrail lives in `workflow/eval/eval.test.ts` alongside the existing client and runner tests. It reads `assistant/conversation-flow.json`, filters to LLM-conditioned edges (`condition.type === "llm"`), collects every `target_edge_ids` value from all imported clinic scenarios, and asserts every LLM edge ID appears in at least one scenario.

**Rationale:** The test suite already runs via `npx tsx workflow/eval/eval.test.ts`. Adding the guardrail there means it runs with the same command, in the same CI step, with no new tooling. A failing guardrail means a developer added a routing edge to the workflow but forgot a scenario — caught before the next eval run.

**Alternatives considered:** A separate `coverage-check.ts` script run before `npm run eval` — adds a step to remember. A pre-commit hook — not all contributors use hooks. The unit test is the simplest enforcement.

### D6: Lifecycle scenario pins a unique future date

**Decision:** The appointment lifecycle scenario's caller persona requests "April 14, 2027 at 2 PM" — a specific date far enough in the future to avoid collisions with prior eval runs. The `AppointmentActor` is keyed by caller number and persists appointments across conversations, so if two runs use the same caller and the same date, the second run's creation would hit a conflict from the first run's leftover booking.

**Rationale:** The Telnyx Tests API simulates a caller from a persona string; the caller number is assigned by the platform. If the platform reuses the same simulated number across runs, leftover state from a prior run would interfere. Pinning a unique future date makes collisions astronomically unlikely. The date is also clearly synthetic (2027) so it's obvious in logs that it's an eval booking, not a real patient.

**Alternatives considered:** Cancel after create in the same conversation and rely on cleanup — the lifecycle scenario already does this, but if the conversation errors out mid-flow, the booking stays. A cleanup script that cancels all appointments for a test caller — requires knowledge of the caller number, which the platform assigns.

### D7: `run-eval.ts` iterates sequentially, not in parallel

**Decision:** `run-eval.ts` runs selected scenarios one at a time, each via `EvalRunner.run(scenario)`. It collects results into an array and prints a summary matrix at the end.

**Rationale:** The Telnyx Tests API creates real conversations against the assistant. Running scenarios in parallel would (a) risk hitting rate limits, (b) make the caller-number-to-state mapping unpredictable for the lifecycle scenario, and (c) make log inspection harder. Sequential execution is slower but deterministic and debuggable.

**Alternatives considered:** Parallel with a concurrency limit of 3 — faster (~2 min vs ~6 min) but harder to debug and risks rate limits. Defensible if the suite grows to 50+ scenarios; not worth it at 23.

### D8: Scenario selection logic in `run-eval.ts`, not in `EvalRunner`

**Decision:** `run-eval.ts` (the CLI entry point) handles flag parsing and scenario filtering. `EvalRunner` continues to take a single `TestScenario` and run it — its interface is unchanged.

**Rationale:** `EvalRunner` is a single-scenario orchestrator (cache + trigger + poll). Mixing multi-scenario selection logic into it would conflate two responsibilities. The CLI is the right place to decide "which scenarios to run" and then call `EvalRunner.run()` for each.

**Alternatives considered:** A `runBatch(scenarios)` method on `EvalRunner` — adds a second orchestration path to a class that currently has one. The CLI can loop just as easily.

## Risks / Trade-offs

- **[Risk] Persona ambiguity causes non-deterministic routing.** The LLM-conditioned edges fire based on the model's interpretation of the caller's utterance. If a persona is ambiguous (e.g., "ask about billing" could be FAQ or escalation), the test becomes flaky. → Mitigation: each persona is written to be explicitly and narrowly targeted at one intent. The dual-criterion rubric (avoid sibling) catches mis-routes. The coverage guardrail catches missing scenarios, not flaky ones — flakiness is diagnosed from the Tests API transcript.

- **[Risk] Eval run cost and duration.** Each scenario is a real conversation using Telnyx Inference tokens. Running all 23 scenarios costs ~6 minutes and consumed tokens. → Mitigation: `--suite` and `--scenario` flags let the user run a cheap subset for iteration. Document expected runtime in README so users plan accordingly. The evals are designed for pre-release regression, not per-PR.

- **[Risk] AppointmentActor state from prior runs.** The lifecycle and conflict scenarios depend on appointment state. If a prior run left a booking, the next run's create step hits an unexpected conflict. → Mitigation: lifecycle persona pins a far-future date (2027). The conflict scenario deliberately creates a conflict and accepts a suggestion, so leftover state doesn't break it. If both fail, the guardrail test (which is static) still passes — only the live eval would catch it.

- **[Risk] Workflow drift: new edge added without a scenario.** A developer adds an LLM-conditioned edge to `conversation-flow.json` but forgets to add a scenario. → Mitigation: the coverage guardrail unit test fails immediately on the next `npx tsx workflow/eval/eval.test.ts` run, naming the uncovered edge. The developer must add a scenario to make the test suite pass.

- **[Trade-off] High-value edges only, not all LLM edges.** This change covers 16 of the ~25 LLM-conditioned edges. The skipped edges are single-path confirmation transitions (e.g., "the caller acknowledges the booking" → anything_else) that every scenario that reaches them implicitly tests. → Trade-off: less explicit coverage for those edges, but they're low-risk (one outgoing LLM edge = no routing decision). The guardrail test can be configured to require coverage for all LLM edges or just the high-value ones; this change starts with high-value only and can expand later.

- **[Trade-off] Static guardrail vs live coverage.** The guardrail checks that a scenario declares coverage for each edge, not that the scenario actually routes correctly. A scenario could declare `target_edge_ids: ["e_intent_to_faq"]` but have a persona that doesn't trigger the FAQ path. → Trade-off: static coverage is fast and catches drift; live correctness is verified by the Tests API rubric. Both layers are needed.
