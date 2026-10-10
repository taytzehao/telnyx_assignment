# Proposal

## Why

ACME Clinic needs an automated voice assistant to handle patient phone calls around the clock. Today, routine calls about hours, location, and appointment management consume staff time that could serve in-clinic patients. A multi-step Voice AI assistant on Telnyx Edge Compute can answer FAQs and manage appointments per-caller with atomic state safety, escalating to a human only when the bot cannot help.

## What Changes

- Add a Conversation Workflow with 19 nodes (2 speak, 13 prompt, 4 tool) that routes callers through greeting, intent detection, FAQ, and appointment management, with a verification gate before each destructive action (create/cancel).
- Add an MCP server with 4 tools (`get_faq`, `create_appointment`, `list_appointments`, `cancel_appointments`) served from the same Edge Function via SSE transport.
- Add a `AppointmentActor` Stateful Actor keyed by caller number for conflict-safe appointment CRUD (read-modify-write atomicity).
- Extend the dynamic webhook endpoint to return per-caller variables that personalize the greeting and influence routing (returning-caller flag, escalation feature flag).
- Add KV-cached FAQ content for hours, location, services, and fees.
- Add observability: structured logging on every webhook + MCP tool call, plus latency measurement.

## Capabilities

### New Capabilities

- `clinic-assistant`: The ACME Clinic voice AI assistant — conversation workflow, FAQ, appointment management (create/list/cancel with conflict detection and verification gates), and escalation behavior. Defines the externally observable behavior callers experience when they phone the clinic.

### Modified Capabilities

None — no existing specs to modify.

## Impact

- **Edge Function** (`edge/src/`): new MCP SSE endpoint at `/mcp`; extended webhook at `/webhook`; new `AppointmentActor` in `edge/src/actors/`; FAQ data seeding in KV; updated `telnyx.toml` bindings for the new actor.
- **MCP tools**: 4 new tool handlers integrated into the Edge Function (no separate deployment).
- **Telnyx AI Assistant**: new assistant with a `conversation_flow` graph (19 nodes, 28 edges) deployed via the Assistants API; requires a phone number assignment.
- **Dependencies**: `@modelcontextprotocol/sdk` for MCP server transport; existing `@telnyx/edge-runtime` for the Stateful Actor.
- **Tests**: unit tests for `AppointmentActor` (conflict detection, CRUD), MCP tool handlers, and webhook dynamic variable resolution.
