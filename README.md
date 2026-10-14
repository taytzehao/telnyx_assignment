# ACME Clinic Voice AI Assistant

A multi-step Voice AI assistant for ACME Clinic, built on Telnyx Edge Compute with per-node webhook tools, conversation workflows, and Stateful Actors for per-caller appointment management.

## Architecture

```
Caller (Phone) → Telnyx AI Assistant (Conversation Workflow)
                      │
           ┌──────────┴───────────────┐
     Dynamic Vars                Webhook Tools
  (assistant.initialization)  (X-End-User-Target header)
           │                          │
           ▼                          ▼
   ┌───────────────────────────────────────┐
   │   Telnyx Edge Function                │
   │   /webhook  → dynamic variables       │
   │   /tools/*  → webhook tools           │
   │   KV: FAQ content, feature flags      │
   │   Actor: CallSession (per caller)     │
   │   Actor: AppointmentActor (per caller)│
   └───────────────────────────────────────┘
```

## Core Components

- **Conversation Workflow** — 19-node graph in `workflow/assistant.config.json` with 2 speak nodes (Greeting + Goodbye), 16 prompt nodes, and 1 tool node (Hangup). Uses both LLM conditions (32 edges) and a variable comparison edge (`telnyx_conversation_duration_secs >= 600` timeout). Node instructions are composed from `workflow/prompts.ts` (see [Workflow prompts](#workflow-prompts)).
- **Caller identity** — the caller is always Telnyx's system variable `telnyx_end_user_target`, never a value the model supplies:
  - The dynamic-variables webhook reads it from the `assistant.initialization` event (`data.payload.telnyx_end_user_target`) and keys both actors by it.
  - Every webhook tool sends it in the `X-End-User-Target` header, whose value is set to `{{telnyx_end_user_target}}` on the shared tool. `/tools/*` rejects requests without the header (`400 missing_end_user_target`).
- **Webhook tools** — 4 tools served from the Edge Function at `/tools/*`: `get_faq`, `create_appointment`, `list_appointments`, `cancel_appointments`. Each prompt node is attached (`shared_tool_ids`, `tools_mode: "replace"`) to only the tools it needs; nodes that only talk to the caller have none. No MCP server is attached to the assistant.
- **Dynamic variables** — `/webhook` returns `greeting`, `call_count`, `is_returning_caller`, `last_intent`, `escalation_enabled`, and `caller_appointments` (the caller's appointments as a JSON list).
- **Stateful Actors**:
  - `CallSession` — per-caller call counting and returning-caller detection.
  - `AppointmentActor` — per-caller appointment CRUD with conflict-safe read-modify-write.
- **KV** — FAQ content (`faq/hours`, `faq/location`, `faq/services`, `faq/fees`) and the escalation feature flag (`flag/escalation_enabled`).

## Workflow prompts

`workflow/assistant.config.json` stores prompt references (`@prompt:<name>`), and `workflow/prompts.ts` holds the text. The deploy resolves them into plain instructions; an unknown marker fails the deploy. Shared rules live in one place and are appended to every node:

- Each step does only its own job, and takes a matching transition when one is offered.
- The caller's answer to a step's closing question is handled by the *next* step, so each step ends with the question that next step needs.
- A step that lacks the tool for a request restates it as a yes-or-no question instead of attempting it, and never writes tool calls as text.
- Today's date comes from `{{telnyx_current_date}}`, so a date without a year resolves to its next occurrence.

These rules follow from how Telnyx routes ([workflow docs](https://developers.telnyx.com/docs/inference/ai-assistants/workflows)). On calls, an LLM edge is offered to the model as a transition tool in the same turn as the reply. On chat channels, edges are evaluated in a separate model call *after* the reply, so the next step only acts once the caller speaks again.

## Production Setup

### 1. Prerequisites

```bash
# Install the Telnyx Edge CLI
curl -fsSL https://github.com/team-telnyx/edge-compute/releases/latest/download/telnyx-edge-linux-amd64.tar.gz | tar xz
sudo mv telnyx-edge /usr/local/bin/
```

`.env` (gitignored — never commit it):

| Variable | Used for |
|---|---|
| `TELNYX_API_KEY` | Telnyx API access for deploys and evals |
| `ASSISTANT_CACHE` | Edge Function base URL, e.g. `https://telnyx-webhook-<org>.telnyxcompute.com` |
| `ASSISTANT_ID` | The assistant to update on redeploy, and the default eval target |

### 2. Deploy the Edge Function and Assistant

```bash
npm install

# Full deploy: edge install → binding types → typecheck → lint → test →
# telnyx-edge ship → health check → assistant deploy (step 3)
npm run deploy
```

Or ship the Edge Function on its own:

```bash
cd edge
telnyx-edge ship
cd ..
```

Deploy notes:

- `telnyx-edge ship` can still be "Monitoring build and deployment status" when `npm run deploy` gives up after 10 minutes. The build may still complete, so check `telnyx-edge deployments telnyx-webhook`, then run `npm run deploy:assistant` once the new revision is active.
- Every checkout ships the same `telnyx-webhook` function, so the most recent ship wins. `telnyx-edge rollback` is not available for functions that own StatefulActor types; to restore a build, ship it again.

### 3. Deploy the AI Assistant

```bash
# Option A: pass the edge function URL directly
npm run deploy:assistant -- --webhook-url https://telnyx-webhook-<org>.telnyxcompute.com

# Option B: use ASSISTANT_CACHE from .env
npm run deploy:assistant
```

The script:

1. Validates the graph in `workflow/assistant.config.json` and resolves the `@prompt:` markers.
2. Creates or updates (in place) the 4 shared webhook tools, each with the `X-End-User-Target` header.
3. Replaces the `PLACEHOLDER_*_TOOL_ID` strings in node `shared_tool_ids` with the real tool IDs.
4. Creates or updates the assistant.

On first run it prints the new assistant ID; set `ASSISTANT_ID` in `.env` for idempotent redeploys. If `ASSISTANT_ID` points at an assistant that no longer exists, the script creates a new one and prints its ID, so update `.env`.

### 4. Assign a Phone Number

In the Telnyx Portal:
1. Go to **AI Assistants** → select the ACME Clinic assistant.
2. Assign a phone number under the assistant's **Phone Numbers** tab.
3. Call the number to test.

### 5. Seed FAQ Data

Optional — defaults are built into the `faq.ts` module. To override via KV:

```bash
# The seedFaqs() helper writes all four FAQ categories to KV.
# Call it from the Edge Function or set via the KV REST API.
```

## Development

```bash
# Edge Function: tests, typecheck, lint
cd edge
npm run test
npm run typecheck
npm run lint
cd ..

# Workflow config, prompts, deploy client
npx tsc --noEmit -p .
npx tsx workflow/builder.test.ts
npx tsx workflow/client.test.ts

# Eval unit tests (client, runner, caller state, scenario composition, coverage guardrail)
npx tsx workflow/eval/eval.test.ts

# Local development
npm run dev  # starts telnyx-edge dev from project root
```

## Running the Clinic Evals

The workflow eval harness tests the deployed AI Assistant's conversation routing, appointment lifecycle, and edge-case handling using the Telnyx Assistant Tests API.

### Prerequisites

- `TELNYX_API_KEY` set in `.env` (used by the eval client).
- `ASSISTANT_CACHE` set in `.env`. The runner resets and seeds each test caller's appointments through the Edge Function, and the eval stops early without it.
- The assistant under test, taken from `ASSISTANT_DESTINATION`, then `.telnyx/assistant.json`, then `ASSISTANT_ID`.
- The Edge Function and assistant deployed (`npm run deploy`).

### Test Suites

| Suite | Scenarios | What it covers | Runtime |
|---|---|---|---|
| `clinic-routing` | 16 | One scenario per high-value LLM-conditioned routing edge (intent→4, appt_menu→4, verify_create→3, verify_cancel→3, anything_else→2). Each uses a dual-criterion rubric: reached expected target + did not diverge to nearest sibling. | ~18 min |
| `clinic-appointment-lifecycle` | 1 | End-to-end create→verify→list→cancel→list in a single conversation. Asserts booking appears after creation, disappears after cancellation, and verification gate fires before both destructive actions. | ~3 min |
| `clinic-edge-cases` | 6 | Out-of-hours slot rejection, FAQ out-of-scope escalation, conflict + accept alternative, mid-collection abandon, explicit human request, anything-else loop twice. | ~7 min |
| `workflow-routing` | 1 | Boilerplate scenario from the original eval harness (`Routing: Handle Request`). | ~1 min |
| **All** | **24** | All of the above (scenarios run one at a time). | **~27 min** |

### CLI Usage

```bash
# Run all scenarios (boilerplate + all clinic)
npm run eval

# Run a single suite
npm run eval -- --suite clinic-routing
npm run eval -- --suite clinic-appointment-lifecycle
npm run eval -- --suite clinic-edge-cases

# Run a single scenario by exact name
npm run eval -- --scenario "Routing: Intent→FAQ"

# Run the boilerplate scenario only
npm run eval -- --suite workflow-routing
```

The CLI prints a summary matrix at the end showing each scenario name, each rubric criterion, and its pass/fail status, followed by a total pass count. Exits non-zero if any criterion failed.

### How each run is prepared

In test runs, Telnyx sets `telnyx_end_user_target` to `ai-assistant-test-<test_id>`. Every test is therefore its own caller, with its own appointments, and that state persists between runs of the same test. Before each run the runner:

1. Pushes the current scenario definition to the test's Telnyx record. `.telnyx/eval-tests.json` only maps scenario names to test IDs, so without this step edited scenarios would never take effect.
2. Cancels all of the test caller's appointments.
3. Creates the scenario's `seed_appointments`.

Steps 2 and 3 go through the Edge Function's own `/tools/*` endpoints with the `X-End-User-Target` header, so the assistant sees exactly the appointments the scenario declares.

### Writing scenarios

Scenario instructions are composed the same way as workflow prompts. In `workflow/eval/scenario-prompts.ts`:

- **`SEEDS`** defines each appointment once: its date, start time, and how the caller says it.
- **`SCENARIO_FRAGMENTS`** holds shared caller text, addressable as `@scenario:<name>`. There are two fragments:
  - `caller_role` — the "You are a caller to ACME Clinic." opener.
  - `keep_conversation_moving` — the caller says yes when the assistant checks its understanding, and "Okay, thanks" when it says it's working on something. On chat channels the next step only acts after the caller's next message, so this keeps the run moving.
- **`@scenario:seeded_appointments`** writes "You have an appointment on …" from the scenario's own seeds. Leave it out when the caller shouldn't know, e.g. when provoking a conflict.

```ts
export const verifyCancelToCancel = defineScenario({
  name: "Routing: VerifyCancel→Cancel",
  instructions: [
    "@scenario:caller_role",
    "@scenario:seeded_appointments",
    "Ask to cancel it. When the assistant reads back the appointment and asks you to confirm, say: \"Yes, go ahead and cancel it.\" Do not request a different appointment. Do not abandon the cancellation.",
    "@scenario:keep_conversation_moving",
  ],
  seed_appointments: [SEEDS.jan15],
  // rubric, channel, suite, target_edge_ids …
});
```

An unknown marker, or `@scenario:seeded_appointments` without seeds, throws. The unit tests also check that every seed is a future 30-minute slot within opening hours.

### Coverage Guardrail

Before running live evals, the unit tests include a coverage guardrail that verifies every high-value LLM-conditioned edge in `workflow/assistant.config.json` is referenced by at least one scenario's `target_edge_ids`. This catches workflow drift — if a developer adds a new routing edge without a corresponding eval scenario, the guardrail test fails:

```bash
# Run the coverage guardrail + all eval unit tests
npx tsx workflow/eval/eval.test.ts
```

The guardrail only requires coverage for the 5 high-value branching nodes (`n_intent`, `n_appt_menu`, `n_verify_create`, `n_verify_cancel`, `n_anything_else`). Deterministic `default`-condition edges and single-path confirmation transitions do not need explicit coverage.

### Interpreting Results

- All criteria passed: the assistant routes correctly for the tested paths.
- A criterion failed: check the Telnyx Portal for the conversation transcript to see where the routing diverged.
- Coverage guardrail fails: add a scenario with `target_edge_ids` covering the named edge.
- **Confirm tool calls in the edge logs, not the grader.** The rubric grader judges only what the assistant says; it does not see tool results. It has passed replies that only contained tool-call-looking text (e.g. `<tool_call>cancel_appointment(…)`) and failed runs where the tool really ran. Check `telnyx-edge logs telnyx-webhook --since 30m` for lines with a `"tool"` field and `"caller":"ai-assistant-test-<test_id>"`; the test ID is in `.telnyx/eval-tests.json`.
- **Chat results are not phone results.** The test runner supports only `web_chat` and `phone_call`, and these scenarios use `web_chat`. There, LLM routing happens after each reply; on phone calls it happens within the same turn.

## Observability

### How to detect the assistant is broken (within 1 minute)

1. **Watch the logs**: Every webhook and tool call emits a structured JSON log line containing `caller`, `node`/`tool`, `outcome`, `latencyMs`, and `requestId`. In the Telnyx Portal, go to your Edge Function's logs. Filter for `"outcome":"error"` — a spike in errors within seconds indicates a failure.

2. **Latency spikes**: Look for `latencyMs` values over 1000 ms in webhook logs. The Telnyx webhook timeout defaults to 1500 ms; values approaching it predict missed timeouts.

3. **Tool failures**: Filter logs for `tool` entries with `"outcome":"conflict"` or `"outcome":"not_found"` — without unexpected conflict or not-found outcomes, the appointment flow is working correctly. HTTP `400` responses from `/tools/*` with `missing_end_user_target` mean a tool is missing its `X-End-User-Target` header.

4. **Caller identity**: `"caller":"unknown"` on webhook lines means the `assistant.initialization` payload had no `telnyx_end_user_target`.

### What to look at first

- `telnyx-edge logs telnyx-webhook` from the Edge Function — scan for any `"outcome":"error"` entries.
- The conversation transcript in the Portal — check which workflow node the conversation reached and whether it stayed there. Routing failures appear as the conversation stuck on a node after the caller's response.
- The `requestId` field in log lines allows correlating webhook calls across the same conversation.

### Debugging trail (from development)

During development, the AppointmentActor's 16:30 slot test initially failed because the `LATEST_SLOT_START` constant was set to `16` (meaning 16:00), which rejected the 16:30 slot as out of range. The test `"accepts the last valid slot (16:30, ending at 17:00)"` caught this immediately — the test expected `success: true` but got `success: false`. The fix was changing the boundary from `LATEST_SLOT_START = 16` to `LATEST_SLOT_START_MIN = 16 * 60 + 30` (990 minutes = 16:30), so the last valid slot (16:30, ending at 17:00) is accepted. This was found via the test, not via live testing — demonstrating the value of unit tests for actor logic.

A second issue was found in the logs, which showed two symptoms:

- Webhook lines all had `"caller":"unknown"`, and the shared `CallSession` count kept climbing. The webhook was reading a top-level `caller_number` field that Telnyx never sends.
- Tool lines arrived with the literal, unresolved caller `{{caller_number}}` or a number the model made up (`555-1234`), because the caller was a tool argument the model filled in.

The fix was to read `data.payload.telnyx_end_user_target` in the webhook and to pass the caller to tools in the `X-End-User-Target` header instead of as an argument.
