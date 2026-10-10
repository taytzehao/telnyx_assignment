# Proposal

## Why

The project has a working Edge Function (dynamic webhook, KV flags, Stateful Actor) and deployment scripts, but no representation of the AI Assistant itself — the agent configuration, conversation workflow graph, or glue to push it to the Telnyx Assistants API. The assistant is a core requirement of the challenge, and without this scaffolding there is nothing to connect the collected caller data to an actual conversational experience. Additionally, the existing webhook returns dynamic variables as a flat JSON object, but the Telnyx API expects them wrapped under a `dynamic_variables` key — so variables are silently ignored today.

## What Changes

- New `workflow/` folder containing the AI Assistant configuration and supporting TypeScript abstractions:
  - `assistant.config.json` — a minimal, structurally-complete `CreateAssistantRequest` payload with a skeleton conversation workflow (speak node, prompt nodes, conditional edges using `default`, `llm`, and `expression` condition types). `instructions_mode` omitted on nodes that should append (the API default).
  - `types.ts` — TypeScript types mirroring the Telnyx Assistants API schema. Re-exports SDK types where the `telnyx` package provides them; defines workflow graph types (`WorkflowNode`, `WorkflowEdge`, `EdgeCondition`, `ConversationFlow`) where the SDK lacks granular exports.
  - `client.ts` — thin wrapper over the `telnyx` SDK for `create`, `update`, and `retrieve` assistant operations. No hand-rolled HTTP code.
  - `builder.ts` — config loader (`loadConfig`), webhook URL injector (`withWebhookUrl`), and graph validator (`validateConfig`) that catches structural errors before hitting the API.
- Updated `scripts/deploy.ts` — after edge deployment succeeds, loads the workflow config, validates it, injects the deployed edge URL as the `dynamic_variables_webhook_url`, and pushes the assistant via the SDK. Caches the assistant ID in `.telnyx/assistant.json` for idempotent redeploys.
- New `scripts/deploy-assistant.ts` — standalone assistant deploy for iterating on workflow config without re-shipping the edge function.
- Fixed `edge/src/webhook.ts` — wraps the response body under `dynamic_variables` so Telnyx actually receives the variables.
- Updated `edge/tests/webhook.test.ts` — assertions adjusted to the new `{"dynamic_variables": {...}}` response shape.
- Updated root `tsconfig.json` — adds `workflow/**/*.ts` to `include`.
- Updated root `package.json` — adds `telnyx` SDK dependency and `deploy:assistant` script.
- Updated `.gitignore` — adds `.telnyx/assistant.json`.

## Capabilities

### New Capabilities

- `assistant-workflow-config`: Manages the Telnyx AI Assistant configuration — the agent settings, conversation workflow graph (nodes, edges, conditions), dynamic variable defaults, and MCP server references — plus the tooling to load, validate, and deploy this configuration to the Telnyx Assistants API.

### Modified Capabilities

(None — no existing specs in the project.)

## Impact

- **New code**: `workflow/` folder (4 files), `scripts/deploy-assistant.ts` (1 file).
- **Modified code**: `scripts/deploy.ts` (add assistant deploy phase), `edge/src/webhook.ts` (response wrapping), `edge/tests/webhook.test.ts` (assertion updates), `tsconfig.json`, `package.json`, `.gitignore`.
- **New dependency**: `telnyx@^7.25.0` added to root `package.json` (already a dependency of `edge/package.json`).
- **APIs**: The `TelnyxAssistantClient` calls `POST /v2/ai/assistants` (create) and `PATCH /v2/ai/assistants/{id}` (update).
- **Runtime behavior**: The webhook now returns `{"dynamic_variables": {...}}` instead of a flat object — the edge function's health endpoints are unaffected.
- **No breaking changes** to existing callers: the health check endpoints remain unchanged; the webhook payload shape change makes the webhook *start working correctly* with the Telnyx runtime rather than changing a previously-working contract.
