# Design

## Context

The project has a deployed Telnyx AI Assistant with a 4-node conversation workflow defined in `workflow/assistant.config.json`: a speak node (Greeting), two prompt nodes (Identify Intent, Handle Request, Escalate), and edges using `default`, `llm`, and `expression` condition types. The Telnyx platform provides a built-in Assistant Tests API (`/ai/assistants/tests`) that treats `instructions` as a test-agent persona (a simulated caller) and `rubric` as an evaluator (criteria Telnyx judges against the conversation transcript). The existing `workflow/client.ts` wraps the `telnyx` SDK for assistant CRUD operations; this change adds an analogous client layer for the Tests API.

## Goals / Non-Goals

**Goals:**
- Scaffold a `workflow/eval/` folder with the minimal structure needed to define test scenarios, call the Telnyx Tests API, and report results.
- Provide one boilerplate scenario that exercises the `n_identify_intent → n_handle` LLM-condition edge, so the pattern is clear for adding more scenarios later.
- Cache test IDs so repeated `npm run eval` invocations reuse existing test configs instead of creating duplicates.
- Handle the edge case where a cached test ID is stale (deleted on Telnyx) by recreating on 404.

**Non-Goals:**
- Multiple test scenarios — one boilerplate scenario demonstrates the pattern; additional scenarios follow the same structure.
- Evaluator dimensions beyond routing correctness — the rubric items focus on whether the conversation reached the expected workflow node.
- CI/CD pipeline integration — the eval runs on demand via `npm run eval`; wiring into a CI pipeline is a future concern.
- Custom simulation engine — all caller simulation and evaluation is handled by the Telnyx Tests API.

## Decisions

### D1: Telnyx Tests API as the eval engine — not custom simulation

**Decision**: Test agents are `instructions` fields in test configs; evaluators are `rubric` items. The Telnyx platform simulates the caller and evaluates the transcript.

**Rationale**: The Telnyx Assistant Tests API is purpose-built for this — it runs a real conversation against the assistant, records the transcript, and evaluates rubric criteria. Reimplementing caller simulation or LLM-as-judge scoring would duplicate platform functionality and diverge from production behavior.

**Alternative considered**: Local LLM simulation where a Telnyx Inference model plays both roles. Rejected — doesn't exercise the real assistant's workflow routing, and doubles token cost.

### D2: `web_chat` channel by default

**Decision**: The boilerplate scenario uses `telnyx_conversation_channel: "web_chat"`. The `destination` field points to the assistant's web chat endpoint.

**Rationale**: Web chat avoids audio/SMS costs, runs faster than phone_call tests, and doesn't require the assistant to have an assigned phone number. The channel is a field on the scenario type, so switching to `phone_call` for specific scenarios is trivial.

**Alternative considered**: `phone_call` as default. Rejected — requires an assigned phone number and incurs telephony costs for every eval run.

### D3: Test ID caching in `.telnyx/eval-tests.json`

**Decision**: After the first `tests.create` call, the returned `test_id` is written to `.telnyx/eval-tests.json` keyed by scenario name. Subsequent runs read the cache and call `runs.trigger` directly.

**Rationale**: Without caching, every `npm run eval` creates a duplicate test config on Telnyx. The Tests API doesn't support listing/searching by name, so there's no way to find an existing test without the ID. A local JSON file is simple and fast.

**Alternative considered**: List all tests and match by name. Rejected — the API paginates and names aren't guaranteed unique. Considered hashing the scenario definition for cache invalidation; rejected as unnecessary for a boilerplate — recreate-on-404 covers the deletion case.

### D4: Recreate-on-error for stale cache

**Decision**: When the runner triggers a run with a cached `test_id` and the API returns 404 (test was deleted on the Telnyx side), the runner silently creates a new test, updates the cache, and triggers a run against the new `test_id`.

**Rationale**: This handles the most common stale-cache scenario (manual deletion in the Telnyx Portal or API) without requiring the user to manually clear the cache. It's a single retry path — no complex hash comparison or version checking.

**Alternative considered**: Hash-based cache invalidation (store a hash of the scenario's `instructions` + `rubric` alongside the `test_id`; recreate if the hash changes). Rejected for the boilerplate — adds complexity without clear benefit. The `--force` flag pattern was also considered but deferred; recreate-on-404 covers the automatic case.

### D5: Reuse the `telnyx` SDK — not raw fetch

**Decision**: The eval client wraps `client.ai.assistants.tests.*` methods from the `telnyx` SDK, mirroring the pattern established by `workflow/client.ts`.

**Rationale**: The SDK is already a dependency, provides TypeScript types, handles authentication, and offers method-level access to the Tests API. The JS code sample in the API docs confirms the SDK surface: `client.ai.assistants.tests.create(params)` and `client.ai.assistants.tests.runs.trigger(test_id)` / `.runs.retrieve(run_id, { test_id })`.

**Alternative considered**: Raw `fetch` wrapper. Rejected — duplicates auth handling and type definitions the SDK already provides.

### D6: Polling-based run completion

**Decision**: After triggering a run, the runner polls `runs.retrieve()` at a configurable interval (default 5 seconds) until the run status is terminal (`passed`, `failed`, or `error`), with a configurable timeout (default 120 seconds).

**Rationale**: The Tests API is asynchronous — `runs.trigger` returns immediately with status `pending` or `starting`. There is no webhook callback for completion. Polling is the simplest reliable approach.

**Alternative considered**: WebSocket or webhook-based completion notification. Rejected — the Tests API doesn't offer this; polling is the documented pattern.

### D7: Single scenario exported as a typed object

**Decision**: `scenarios.ts` exports one `TestScenario` object with explicit, typed fields. The type includes `name`, `instructions`, `rubric`, `destination`, `telnyx_conversation_channel`, `test_suite`, and optional `max_duration_seconds`.

**Rationale**: A single exported object makes the pattern immediately clear. Adding a second scenario is a matter of adding another object and an array — no structural change needed.

**Alternative considered**: JSON config file for scenarios (like `assistant.config.json`). Rejected for the boilerplate — a TS file provides type safety and is more self-documenting. Can be migrated to JSON later if scenarios proliferate.

## Risks / Trade-offs

- **SDK method availability**: The `telnyx` SDK may not expose `client.ai.assistants.tests.*` methods in version ^7.25.0, or the method signatures may differ from the API docs' JS samples. → Mitigation: inspect the installed SDK's type exports during implementation; fall back to raw `fetch` with the same endpoint paths if the SDK lacks test methods.

- **Test run duration**: Phone_call tests can take 30+ seconds; even web_chat tests may take 10–20 seconds for the conversation + evaluation. Polling blocks the CLI. → Mitigation: configurable poll interval and timeout; print progress dots during polling.

- **Destination configuration**: The `destination` field must point to a live assistant endpoint. If the assistant isn't deployed or the number isn't assigned, the test run will fail. → Mitigation: the CLI checks for a configured destination (from env or `.telnyx/assistant.json`) before triggering and prints a clear error if missing.

- **Cache file lost**: If `.telnyx/eval-tests.json` is deleted, the next run creates a new test (duplicate on Telnyx). → Mitigation: document in the file that it should not be deleted; the recreate-on-error path means the only consequence is a duplicate test config, not a broken eval.
