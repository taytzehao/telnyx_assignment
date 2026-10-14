# ACME Clinic Voice AI Assistant

A multi-step Voice AI assistant for ACME Clinic, built on Telnyx Edge Compute with a custom MCP server, conversation workflows, and Stateful Actors for per-caller appointment management.

## Architecture

```
Caller (Phone) → Telnyx AI Assistant (Conversation Workflow)
                      │
           ┌──────────┼──────────────┐
      Dynamic Vars    MCP Tools    (Edge routing)
           │          │
           ▼          ▼
   ┌─────────────────────────────────┐
   │   Telnyx Edge Function           │
   │   /webhook  → dynamic variables  │
   │   /mcp      → MCP server (SSE)   │
   │   KV: FAQ cache, flags, session  │
   │   Actor: CallSession (per-caller)│
   │   Actor: AppointmentActor        │
   └─────────────────────────────────┘
```

## Core Components

- **Conversation Workflow** — 19-node graph in `workflow/assistant.config.json` with 2 speak nodes (Greeting + Goodbye), 16 prompt nodes, and 1 tool node (Hangup). Uses both LLM conditions (32 edges) and a variable comparison edge (`telnyx_conversation_duration_secs >= 600` timeout).
- **MCP Server** — 4 tools served from the Edge Function at `/mcp`: `get_faq`, `create_appointment`, `list_appointments`, `cancel_appointments`.
- **Stateful Actors**:
  - `CallSession` — per-caller call counting and returning-caller detection.
  - `AppointmentActor` — per-caller appointment CRUD with conflict-safe read-modify-write.
- **KV** — FAQ content cache (`faq:hours`, `faq:location`, `faq:services`, `faq:fees`), escalation feature flag (`flag:escalation_enabled`), session data.

## Production Setup

### 1. Prerequisites

```bash
# Install the Telnyx Edge CLI
curl -fsSL https://github.com/team-telnyx/edge-compute/releases/latest/download/telnyx-edge-linux-amd64.tar.gz | tar xz
sudo mv telnyx-edge /usr/local/bin/

# Set your API key in .env (never commit this!)
echo 'TELNYX_API_KEY=your-key-here' > .env
```

### 2. Deploy the Edge Function

```bash
# From the project root
npm install

# Deploy the Edge Function (includes /webhook + /mcp endpoints)
cd edge
telnyx-edge ship
cd ..

# Note the live URL from the ship output, e.g.:
# https://telnyx-webhook-<org>.telnyxcompute.com
```

### 3. Deploy the AI Assistant

The assistant config lives at `workflow/assistant.config.json` (19-node conversation flow + assistant metadata). The deploy script loads it, validates the graph, injects the webhook URL, and creates/updates the assistant via the Telnyx SDK.

```bash
# Option A: pass the edge function URL directly
npm run deploy:assistant -- --webhook-url https://telnyx-webhook-<org>.telnyxcompute.com

# Option B: set ASSISTANT_CACHE in .env (the edge function base URL)
echo 'ASSISTANT_CACHE=https://telnyx-webhook-<org>.telnyxcompute.com' >> .env
npm run deploy:assistant
```

On first run the script prints the new assistant ID. Set `ASSISTANT_ID` in `.env` for idempotent redeploys:

```bash
echo 'ASSISTANT_ID=assistant-...' >> .env
npm run deploy:assistant
```

The MCP server URL must be registered as an MCP integration in the Telnyx Portal (AI Assistants → Select assistant → Integrations → Add MCP Server → URL: your Edge Function `/mcp` endpoint).

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
# Run tests, typecheck, and lint
cd edge
npm run test
npm run typecheck
npm run lint

# Local development
npm run dev  # starts telnyx-edge dev from project root

# Run eval unit tests (client, runner, coverage guardrail, scenario shape)
npx tsx workflow/eval/eval.test.ts
```

## Running the Clinic Evals

The workflow eval harness tests the deployed AI Assistant's conversation routing, appointment lifecycle, and edge-case handling using the Telnyx Assistant Tests API.

### Prerequisites

- `TELNYX_API_KEY` set in `.env` (used by the eval client)
- `ASSISTANT_DESTINATION` set in `.env` or `.telnyx/assistant.json` cached from a prior deploy
- The assistant must be deployed (`npm run deploy:assistant`)

### Test Suites

| Suite | Scenarios | What it covers | Runtime |
|---|---|---|---|
| `clinic-routing` | 16 | One scenario per high-value LLM-conditioned routing edge (intent→4, appt_menu→4, verify_create→3, verify_cancel→3, anything_else→2). Each uses a dual-criterion rubric: reached expected target + did not diverge to nearest sibling. | ~4 min |
| `clinic-appointment-lifecycle` | 1 | End-to-end create→verify→list→cancel→list in a single conversation. Asserts booking appears after creation, disappears after cancellation, and verification gate fires before both destructive actions. | ~4 min |
| `clinic-edge-cases` | 6 | Out-of-hours slot rejection, FAQ out-of-scope escalation, conflict + accept alternative, mid-collection abandon, explicit human request, anything-else loop twice. | ~4 min |
| `workflow-routing` | 1 | Boilerplate scenario from the original eval harness (`Routing: Handle Request`). | ~15s |
| **All** | **24** | All of the above. | **~12 min** |

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

### Coverage Guardrail

Before running live evals, the unit tests include a coverage guardrail that verifies every high-value LLM-conditioned edge in `assistant/conversation-flow.json` is referenced by at least one scenario's `target_edge_ids`. This catches workflow drift — if a developer adds a new routing edge without a corresponding eval scenario, the guardrail test fails:

```bash
# Run the coverage guardrail + all eval unit tests
npx tsx workflow/eval/eval.test.ts
```

The guardrail only requires coverage for the 5 high-value branching nodes (`n_intent`, `n_appt_menu`, `n_verify_create`, `n_verify_cancel`, `n_anything_else`). Deterministic `default`-condition edges and single-path confirmation transitions do not need explicit coverage.

### Interpreting Results

- All criteria passed: the assistant routes correctly for the tested paths.
- A criterion failed: check the Telnyx Portal for the conversation transcript to see where the routing diverged.
- Coverage guardrail fails: add a scenario with `target_edge_ids` covering the named edge.

## Observability

### How to detect the assistant is broken (within 1 minute)

1. **Watch the logs**: Every webhook and MCP tool call emits a structured JSON log line containing `caller`, `node`/`tool`, `outcome`, `latencyMs`, and `requestId`. In the Telnyx Portal, go to your Edge Function's logs. Filter for `"outcome":"error"` — a spike errors within seconds indicates a failure.

2. **Latency spikes**: Look for `latencyMs` values over 1000 ms in webhook logs. The Telnyx webhook timeout defaults to 1500 ms; values approaching it predict missed timeouts.

3. **MCP tool failures**: Filter logs for `tool` entries with `"outcome":"conflict"` or `"outcome":"not_found"` — without unexpected conflict or not-found outcomes, the appointment flow is working correctly.

### What to look at first

- `telnyx-edge logs` from the Edge Function — scan for any `"outcome":"error"` entries.
- The conversation transcript in the Portal — check which workflow node the conversation reached and whether it stayed there. Routing failures appear as the conversation stuck on a node after the caller's response.
- The `requestId` field in log lines allows correlating webhook calls across the same conversation.

### Debugging trail (from development)

During development, the AppointmentActor's 16:30 slot test initially failed because the `LATEST_SLOT_START` constant was set to `16` (meaning 16:00), which rejected the 16:30 slot as out of range. The test `"accepts the last valid slot (16:30, ending at 17:00)"` caught this immediately — the test expected `success: true` but got `success: false`. The fix was changing the boundary from `LATEST_SLOT_START = 16` to `LATEST_SLOT_START_MIN = 16 * 60 + 30` (990 minutes = 16:30), so the last valid slot (16:30, ending at 17:00) is accepted. This was found via the test, not via live testing — demonstrating the value of unit tests for actor logic.
