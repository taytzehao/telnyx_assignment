# Design

## Context

The repository already contains a scaffolded Edge Function (`edge/src/`) with a `/webhook` endpoint, a `CallSession` Stateful Actor, KV helpers, and a JSON logger. The Telnyx Edge Function runtime (`telnyx.toml`) binds a single KV namespace (`SESSIONS`) and the existing `CallSession` actor. No MCP server, no appointment logic, and no AI assistant conversation flow exist yet. This change layers the clinic assistant behavior on top of that scaffold.

## Goals / Non-Goals

**Goals:**

- Serve the MCP protocol and dynamic-webhook endpoints from a single Edge Function deployment that directly accesses KV and Stateful Actors without extra HTTP hops.
- Make appointment creation and cancellation safe against concurrent calls from the same caller using a Stateful Actor.
- Scope every MCP tool to the current caller so no cross-caller data leaks.
- Produce readable structured logs + latency on every webhook and MCP tool call so failures are diagnosable from evidence, not guesses.

**Non-Goals:**

- Doctor availability tracking or multi-provider scheduling — MVP assumes all slots are bookable if not already taken by the caller.
- Caller authentication or identity verification beyond STIR/SHAKEN — caller phone number is the identity.
- Time-range-based bulk cancellation — MVP supports cancellation by specific time slot or appointment ID only.
- Call transfer to a live agent — escalation informs the caller to call a human line and ends the call.
- Persisting appointments across Edge Function restarts beyond the actor's durable storage model — per-caller storage on the actor is sufficient for MVP.

## Decisions

### D1: Single Edge Function for webhook + MCP

**Choice:** Serve the MCP server from the same Edge Function (`/mcp` route) as the dynamic webhook (`/webhook` route).

**Rationale:** The MCP tools need direct access to `AppointmentActor` for atomic appointment CRUD and to KV for FAQ content. Co-locating the MCP server with the webhook in one function means tool handlers call actor stubs and KV directly, with no extra HTTP hop. One `telnyx-edge ship` produces both endpoints and one public URL to register with the AI assistant.

**Alternatives considered:**
- Separate Edge Function for MCP — cleaner isolation but adds a network hop between the MCP tool handler and the actor/KV, doubling latency and requiring a shared actor binding across functions (a stretch goal, not a baseline). Not worth it for an MVP.
- Standalone non-Edge MCP server — violates the "all backends on Edge Compute" requirement.

### D2: AppointmentActor for per-caller appointment state

**Choice:** Add a new `AppointmentActor` Stateful Actor keyed by `callerNumber`, storing a sorted list of `{ id, date, start_time, end_time }` entries.

**Rationale:** Appointment creation is a read-check-then-write sequence: read existing appointments → check for overlap → insert if no conflict. The Stateful Actor's single-threaded dispatch serializes this per caller, so two concurrent calls from the same number cannot both pass the conflict check and double-insert. This is exactly the read-modify-write primitive the challenge calls out Actors for.

The actor is keyed by `callerNumber` (not by appointment ID or date), so each caller's appointment list is an independent actor instance. Listing and cancellation read/modify only that caller's slice — no locks across callers.

**Alternatives considered:**
- KV for appointment storage — KV lacks atomic read-modify-write. Two concurrent creates could both read an empty slot, both pass the conflict check, and both write, producing a double-booking. Acceptable for cached FAQ content; not safe for appointment state.
- External database — unnecessary for MVP volume and violates the preference for KV/Actor over external stores.

### D3: KV for FAQ content + escalation flag

**Choice:** Store FAQ text under `faq:hours`, `faq:location`, `faq:services`, `faq:fees` keys and the escalation toggle under `flag:escalation_enabled`. KV is pre-seeded at deploy time.

**Rationale:** FAQ content is read-only and shared across all callers — a textbook KV cache. The escalation flag already exists in the scaffold and demonstrates the KV feature-flag pattern. FAQ lookups avoid hitting an external source on every call.

**Alternatives considered:**
- Hardcode FAQ in tool handler strings — no ability to update without redeploying, and it skips demonstrating KV on the_FAQ workload, which is a grading criterion.
- Store FAQs in the actor — wrong primitive: FAQs are shared, not per-caller.

### D4: Speak nodes for greeting and goodbye

**Choice:** Use speak nodes (not prompt nodes) for the greeting and goodbye, with the greeting interpolating a dynamic `{{greeting}}` variable.

**Rationale:** The challenge requires at least one speak node for verbatim/compliance messages. A verbatim greeting and a verbatim thank-you/goodbye also serve the UX goal of a consistent clinic voice on every call.

The greeting interpolates `{{greeting}}`, which the webhook resolves per-caller (first-time vs. returning). The goodbye is a fixed string.

**Alternatives considered:**
- Prompt node for greeting — the model would paraphrase the greeting, so it would no longer be verbatim. Not acceptable for the compliance speak-node requirement.

### D5: Verification gate prompt nodes before destructive tool nodes

**Choice:** Insert `Verify Create` and `Verify Cancel` prompt nodes between the detail-collection step and the tool node for both creation and cancellation. Each verification node reads back the proposed action and asks the caller to confirm before the tool executes.

**Rationale:** The caller must explicitly confirm before any appointment is created or cancelled. If the caller gives feedback to change the details, an LLM-condition edge routes back to the collection node with the caller's revision; if the caller confirms, the LLM edge fires to the tool node. This matches the user's explicit requirement.

**Alternatives considered:**
- Confirm inside the MCP tool — would require the tool to call back into the conversation, which MCP tools cannot do. The tool runs after the model turn completes, so the check has to happen before the tool node.
- Single combined confirm node for both create and cancel — different details to read back, so splitting keeps each node focused (per the "keep nodes focused" best practice).

### D6: Variable comparison edges on tool nodes + LLM edges elsewhere

**Choice:** Use variable-comparison edges (`telnyx_last_tool_status_code == "200"`) on the Create and Cancel tool nodes for success routing, with a default edge to the retry/suggest path. Use LLM-condition edges for every intent-routed and confirmation-routed step. The post-action checkpoint ("Anything Else?") uses LLM edges to either loop back to intent detection or route to the goodbye.

**Rationale:** Challenge requires both LLM conditions and variable comparisons. Tool outcome (HTTP 200 vs. conflict/error) is deterministic, so a variable comparison is the right primitive there. Intent and caller-confirmation decisions depend on what the caller said, so LLM conditions are the right primitive there.

**Alternatives considered:**
- All-LLM routing — would leave the challenge's "variable comparison" requirement unsatisfied and is less reliable for tool outcomes that are already known deterministically.
- All-variable routing — would require encoding every intent as a discrete variable, which the LLM has to populate and which is brittle for natural-language intent detection.

### D7: Reuse the existing CallSession actor; add AppointmentActor separately

**Choice:** Keep the existing `CallSession` actor for call counting + returning-caller detection (already wired into the webhook). Add the `AppointmentActor` as a second actor binding in `telnyx.toml`. The webhook continues to use `CallSession` for greeting personalization; MCP tool handlers use `AppointmentActor` for appointment state.

**Rationale:** The existing scaffold already implements returning-caller detection on `CallSession`, and the webhook already returns `greeting`, `is_returning_caller`, and `call_count`. Reusing it avoids reimplementing that logic. `AppointmentActor` is a distinct entity state (per-caller appointment list) and is its own actor — appointments and call counters are unrelated read-modify-write concerns.

**Alternatives considered:**
- Merge appointment state into `CallSession` — would conflate two unrelated responsibilities and bloat the actor, making it harder to reason about each independently.
- Replace `CallSession` with `AppointmentActor` only — would lose returning-caller detection that is already wired into the webhook.

### D8: Escalation = inform and end call, not transfer

**Choice:** The Escalate node is a prompt node that informs the caller to call a human assistance line. After the caller acknowledges, an LLM edge routes to the Goodbye speak node, which runs the Hangup tool node.

**Rationale:** The user explicitly chose "inform and end call" for the MVP. This avoids wiring up a transfer shared tool and a dedicated phone number, and keeps the escalation path simple to test and demonstrate.

**Alternatives considered:**
- Transfer to a phone number via a transfer tool node — sturdier UX but out of MVP scope per the user's decision. Can be added later by swapping the Escalate prompt node for a transfer tool node.

### D9: Cancellation by specific time or appointment ID only

**Choice:** The `cancel_appointments` MCP tool accepts `cancel_by: "time" | "id"`. When `cancel_by` is `"time"`, the caller supplies `date` + `start_time` and the tool cancels the matching slot. When `cancel_by` is `"id"`, the tool cancels by appointment ID (typically read from the listing step).

**Rationale:** The user explicitly scoped out time-range cancellation for the MVP. Two specific matchers cover the single-appointment delete cases the user mentioned.

**Alternatives considered:**
- Support time-range cancellation as well — would require a richer criteria object with optional range fields. Deferred to a later change per the user's decision.

### D10: Single conversation_flow graph deployed via the Assistants API

**Choice:** Define the 19-node, 28-edge workflow as a `conversation_flow` JSON payload and deploy it to a Telnyx AI Assistant via the Assistants API. The workflow definition lives alongside the code (not in the Portal) so the graph is reproducible from repo state.

**Rationale:** The Portal Builder is manual and not version-controlled. The API `conversation_flow` payload is a single artifact that can be re-applied from the repo, making the assistant configuration reproducible. The challenge calls this out as the API option.

### D11: Tool scoping per node

**Choice:** The `Answer FAQ` node only exposes the `get_faq` tool. The `Create Appointment` tool node only references `create_appointment`. The `List Appointments` tool node only references `list_appointments`. The `Cancel Appointments` tool node only references `cancel_appointments`. Prompt nodes that collect details or confirm do not expose MCP tools — they converse, then an LLM edge transitions to the tool node.

**Rationale:** Per the challenge's "scope tools per node" guidance, exposing only the relevant tool on each step reduces the chance the model calls the wrong tool. Collection/verification nodes should not have direct tool access — they gather and confirm, and the tool runs deterministically on its dedicated node.

## Risks / Trade-offs

- **[Risk] MCP tool latency budget.** The dynamic webhook has a 1.5 s default timeout. The MCP SSE endpoint lives in the same function, so tool calls also need to stay under their own client timeout. Actor calls are fast but creating an appointment does several storage reads + a write. → Mitigation: the actor's storage operations are backed by Edge-Compute-native durable storage; keep the suggestion generation in-memory (compute the next few free slots in JS without extra reads). Measure and log tool latency to catch regressions.

- **[Risk] LLM routing misses on voice calls.** On calls, LLM-condition edges fire through a tool call the model must select. If a node's instructions forbid tool calls, the routing silently sticks. → Mitigation: do not put "do not use tools" instructions on any call-facing node; instead, write edge prompts as explicit transition descriptions ("Caller explicitly confirms..."). Test every routing path with the production model before demo day.

- **[Risk] Concurrent calls from the same caller race the webhook.** The existing webhook uses `CallSession` (single-threaded) so call counting is safe. The `AppointmentActor` provides the same guarantee for appointments. → Mitigation: keep all appointment mutations inside the actor; do not bypass it from the MCP layer.

- **[Risk] Verification prompt mis-detects a "no, change X" as a confirmation.** If the LLM classifies "Yes, but make it Tuesday instead" as a confirmation, the tool node fires with the wrong details. → Mitigation: the Verify prompt explicitly instructs "only treat an unqualified yes as confirmation; any change to the details means route back." Add a negative test case for this in tasks.

- **[Trade-off] One capability spec, not three.** Combining the workflow behavior, FAQ behavior, and appointment-store behavior into one `clinic-assistant` capability keeps the spec focused on caller-visible behavior. If the MCP server or appointment store evolves into a separately-owned capability later, the spec can be split at that point.

- **[Trade-off] Appointment state on the actor only.** For the MVP the per-caller appointment list lives entirely inside `AppointmentActor` durable storage. If volume grows or we need cross-caller reporting, the actor pattern becomes the bottleneck and a real database becomes necessary. Out of scope for now.
