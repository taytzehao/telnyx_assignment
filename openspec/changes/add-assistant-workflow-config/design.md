# Design

## Context

The project has a working Telnyx Edge Function (`edge/src/`) that handles dynamic webhook variables, KV feature flags, and a `CallSession` Stateful Actor. The deploy script (`scripts/deploy.ts`) ships only the edge function. There is no representation of the AI Assistant itself — no config file, no graph definition, and no code to push it to the Telnyx Assistants API. The conversation workflows API stores the workflow as `conversation_flow` on the assistant, and the assistant is created or updated via `POST /v2/ai/assistants` (create) or `PATCH /v2/ai/assistants/{id}` (update).

The existing webhook (`edge/src/webhook.ts`) returns dynamic variables as a flat JSON object, but the Telnyx dynamic variables specification requires them wrapped under a top-level `dynamic_variables` key. This means variables are currently silently ignored by the Telnyx runtime.

The root `tsconfig.json` currently includes only `scripts/**/*.ts`. The root `package.json` has `tsx` and `typescript` as dev dependencies but no `telnyx` dependency. The edge's `package.json` already depends on `telnyx@^7.25.0`.

## Goals / Non-Goals

**Goals:**
- Create a self-contained `workflow/` folder where a developer can define the assistant + workflow config as a single JSON file, with TS types for validation and a builder for loading/injecting/validating.
- Wire the assistant deploy into the existing edge deploy pipeline so one command ships the full stack end-to-end.
- Fix the webhook response shape so dynamic variables flow correctly into the assistant.
- Use the `telnyx` SDK rather than hand-rolled HTTP for all assistant API calls.

**Non-Goals:**
- Domain-specific workflow content (intent routing, dialogue scripts, business logic) — the config is a skeleton with placeholder instructions.
- MCP server implementation or configuration — the config references MCP servers by ID only.
- Portal-based assistant creation — this change is API/CLI-driven only.
- Assistant phone number assignment — the deploy reports the assistant ID; number assignment is a manual step in the Portal.

## Decisions

### D1: Single flat JSON config file — not split per-node

**Decision**: The entire `CreateAssistantRequest` payload lives in one `workflow/assistant.config.json` file.

**Rationale**: The Telnyx API treats `conversation_flow` atomically — you send the full graph on create/update. A single file mirrors the wire format, avoids an assembly layer, and keeps the config inspectable as one artifact. For a skeleton workflow with 4–5 nodes, splitting per-node would add complexity without benefit.

**Alternative considered**: Separate JSON files per node/section assembled at deploy time. Rejected — the graph is small enough that a single file is readable, and the API is atomic so any partial-assembly step is just recombining what you started with.

### D2: Telnyx SDK — not raw fetch

**Decision**: The assistant client wraps the `telnyx` SDK (`client.ai.assistants.create/update/retrieve`), not a hand-rolled `fetch` wrapper.

**Rationale**: The SDK is already a dependency of the edge function, ships TypeScript types, handles authentication, and provides method-level access to the Assistants API. Re-implementing HTTP calls would duplicate the SDK's type safety and auth handling.

**Alternative considered**: A raw `fetch` wrapper. Rejected — no benefit over the SDK, and would require maintaining custom error parsing and type definitions that the SDK already provides.

### D3: Re-export SDK types, supplement with workflow graph types

**Decision**: `types.ts` re-exports types from the `telnyx` SDK where the SDK provides them (e.g., the assistant create/update params). Where the SDK's type surface is too broad or lacks granular workflow-specific types (e.g., `WorkflowNode` as a discriminated union of prompt/speak/tool, `EdgeCondition` as a discriminated union of llm/expression/default), the file defines its own and uses them in the config-loading code.

**Rationale**: Minimizes type duplication while providing the discriminated-union exhaustiveness checking needed for the validator. The SDK's `AIAssistantCreateParams` covers the top-level assistant fields; the workflow graph's node/edge unions are the gap.

**Alternative considered**: Define every type from scratch. Rejected — would diverge from SDK updates over time.

### D4: snake_case field names throughout

**Decision**: The JSON config and TS types use `snake_case` field names matching the raw Telnyx API wire format. No `camelCase`-to-`snake_case` conversion layer.

**Rationale**: The Telnyx API accepts `snake_case` (`conversation_flow`, `start_node_id`, `instructions_mode`, `dynamic_variables_webhook_url`). The SDK also accepts `snake_case`. Using one convention everywhere means the JSON file, the TS types, and the wire payload are identical — no transform step, no risk of a conversion bug.

**Alternative considered**: `camelCase` in config, convert at deploy time. Rejected — adds a conversion layer that can silently drop or misname fields.

### D5: Webhook URL injection at deploy time

**Decision**: The config file has an empty `dynamic_variables_webhook_url`. The `builder.ts` `withWebhookUrl` function fills it after the edge function is deployed and its URL is known.

**Rationale**: The edge URL is dynamic (first deploy generates it via `telnyx-edge ship`). The config can't hardcode it. Injecting at deploy time keeps the config portable and avoids manual URL edits between environments.

**Alternative considered**: Prompt the user for the URL or require it as a config field. Rejected — the full deploy script already knows the URL from `telnyx-edge inspect`.

### D6: Assistant ID caching in `.telnyx/assistant.json`

**Decision**: After the first assistant `create`, the returned assistant ID is written to `.telnyx/assistant.json` (gitignored). On subsequent deploys, the cached ID triggers an `update` call instead of `create`.

**Rationale**: Without caching, every `npm run deploy` creates a duplicate assistant. Listing all assistants and matching by name is slower and ambiguous if names aren't unique. A local file is simple and fast.

**Alternative considered**: List assistants by name and update the match. Rejected — slower, and name collisions are possible.

### D7: Prompt node `instructions_mode` defaults to `append`

**Decision**: The `instructions_mode` field is optional in the TS type. The JSON config omits it on nodes that should append. The API applies `append` as the default when the field is absent.

**Rationale**: The Telnyx workflows documentation states "append mode is usually the safest default" because it preserves the assistant's global policies, tone, and business rules. Omitting the field reduces noise in the config — `replace` is the exception and is marked explicitly.

**Alternative considered**: Always specify `instructions_mode` explicitly. Rejected — adds noise for the common case, and the API already defaults to `append`.

### D8: Webhook response wrapping fix

**Decision**: `edge/src/webhook.ts` changes `Response.json(dynamicVars)` to `Response.json({ dynamic_variables: dynamicVars })`.

**Rationale**: The Telnyx dynamic variables specification requires the webhook response to wrap variables under a top-level `dynamic_variables` key. The current flat response is silently ignored by the Telnyx runtime.

**Alternative considered**: None — this is a bug fix, not a design choice.

## Risks / Trade-offs

- **SDK type availability**: If the `telnyx` SDK does not export granular types for the assistant create/update params, `types.ts` will need more hand-written definitions than planned. → Mitigation: inspect the installed SDK's type exports during implementation; fall back to structural types only for the gaps.

- **SDK API surface mismatch**: The SDK's method names or param shapes may differ from what the docs show (e.g., `create` vs `new`, snake_case vs camelCase params). → Mitigation: verify against the installed SDK version during implementation; the edge `package.json` pins `^7.25.0`.

- **Webhook test rewrite**: Changing the response shape means every assertion in `edge/tests/webhook.test.ts` that reads `data.call_count` must change to `data.dynamic_variables.call_count`. → Mitigation: straightforward find-and-replace, verified by running `npm run test` in the edge directory.

- **`.telnyx/assistant.json` lost**: If the cached ID file is deleted, the next deploy creates a duplicate assistant instead of updating. → Mitigation: document in README that the file should not be deleted; the standalone deploy script can accept an explicit `--assistant-id` flag (deferred — not in this change's scope unless trivial).

- **Config validation is structural only**: The validator checks graph integrity but not semantic correctness (e.g., it won't flag an LLM condition prompt that's too vague). → Trade-off: semantic validation requires an LLM call, which is out of scope. The validator catches the structural errors that the API would reject anyway, but earlier and with better messages.
