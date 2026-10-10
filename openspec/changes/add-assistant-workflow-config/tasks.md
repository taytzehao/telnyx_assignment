# Tasks

## 1. Project Setup

- [x] 1.1 Add `telnyx@^7.25.0` to root `package.json` as a dependency and add `"deploy:assistant": "tsx scripts/deploy-assistant.ts"` to scripts. Verify by running `npm install` and confirming `node -e "require('telnyx')"` succeeds.
- [x] 1.2 Update root `tsconfig.json` to add `"workflow/**/*.ts"` to the `include` array. Verify by running `npx tsc --noEmit` and confirming it no longer ignores the `workflow/` directory.
- [x] 1.3 Add `.telnyx/assistant.json` to `.gitignore`. Verify by running `git status` and confirming the entry is present.

## 2. Workflow Types

- [x] 2.1 Inspect the installed `telnyx` SDK's exported types (check `node_modules/telnyx` types) to determine what assistant-related types the SDK provides and what method names it uses for create/update/retrieve. Record findings as a code comment in `types.ts`.
- [x] 2.2 Create `workflow/types.ts` with TypeScript types mirroring the Telnyx Assistants API schema: re-export SDK types where available; define discriminated unions for `WorkflowNode` (prompt/speak/tool), `EdgeCondition` (llm/expression/default), `EdgeTarget`, `Operand`, `ComparisonExpression`, `ConversationFlow`, and the top-level `CreateAssistantRequest` / `Assistant` types. Use `snake_case` field names matching the API wire format. Make `instructions_mode` optional on `PromptNode`. Verify by running `npx tsc --noEmit` and confirming no type errors.

## 3. Assistant Configuration File

- [x] 3.1 Create `workflow/assistant.config.json` with a minimal `CreateAssistantRequest` payload: agent name, placeholder instructions, `telnyx/zai-org/GLM-5.2` model, empty `dynamic_variables_webhook_url`, `dynamic_variables` defaults matching the edge webhook output fields, `mcp_servers: []`, and a skeleton `conversation_flow` with one speak node (Greeting), three prompt nodes (Identify Intent, Handle Request, Escalate), and four edges using `default`, `llm`, and `expression` condition types. Omit `instructions_mode` on nodes that should append. Verify by running `npx tsx -e "import { loadConfig } from './workflow/builder'; loadConfig('workflow/assistant.config.json')"` after task 4.1, or by confirming the JSON parses with `JSON.parse(readFileSync(...))` inline.

## 4. Workflow Builder

- [x] 4.1 Create `workflow/builder.ts` with `loadConfig(path: string): CreateAssistantRequest` that reads and `JSON.parse`s the config file, `withWebhookUrl(config, url): CreateAssistantRequest` that returns a new config with the webhook URL injected, and `validateConfig(config): ValidationResult` that checks graph integrity (start node exists, edge references valid, speak nodes have exactly one outgoing default edge, tool nodes with edges have one default edge, node/edge IDs unique, required fields non-empty). Verify by running `npx tsc --noEmit` and confirming the module compiles.
- [x] 4.2 Write tests for `validateConfig` covering: valid config passes, missing start node rejected, speak node with zero or multiple default edges rejected, duplicate node IDs rejected, edge targeting non-existent node rejected. Create tests at `workflow/builder.test.ts` using vitest (or inline tsx assertions if root test runner is not configured). Verify by running the tests and confirming all cases pass.

## 5. Workflow Client

- [x] 5.1 Create `workflow/client.ts` with a `TelnyxAssistantClient` class that wraps the `telnyx` SDK. Constructor reads `TELNYX_API_KEY` from `process.env` and throws if unset. Methods: `create(config)` calls `client.ai.assistants.create(config, { idempotencyKey })`, `update(id, config)` calls the SDK update method, `retrieve(id)` calls the SDK retrieve method. Use the exact method names discovered in task 2.1. Verify by running `npx tsc --noEmit` and confirming the module compiles against the installed SDK.
- [x] 5.2 Write a test for `TelnyxAssistantClient` initialization: constructor reads `TELNYX_API_KEY` from env, throws a clear error when it is unset. Create test at `workflow/client.test.ts` (or extend the builder test file). Verify by running the test and confirming it passes.

## 6. Webhook Response Fix

- [x] 6.1 Update `edge/src/webhook.ts` to wrap the success response body as `Response.json({ dynamic_variables: dynamicVars })` instead of `Response.json(dynamicVars)`. Leave the error response unchanged. Verify by reading the file and confirming the success path wraps under `dynamic_variables` while the error path returns `{ error, request_id }`.
- [x] 6.2 Update `edge/tests/webhook.test.ts` to adjust all assertions that read response fields directly. Change `data.call_count` to `data.dynamic_variables.call_count`, `data.is_returning_caller` to `data.dynamic_variables.is_returning_caller`, `data.greeting` to `data.dynamic_variables.greeting`, `data.escalation_enabled` to `data.dynamic_variables.escalation_enabled`, `data.caller_number` to `data.dynamic_variables.caller_number`, `data.call_session_id` to `data.dynamic_variables.call_session_id`, `data.current_node` to `data.dynamic_variables.current_node`, and `data.last_intent` to `data.dynamic_variables.last_intent`. Verify by running `cd edge && npm run test` and confirming all 7 tests pass.

## 7. Deploy Scripts

- [x] 7.1 Update `scripts/deploy.ts` to add an assistant deploy phase after the edge function ships and the URL is extracted: import `loadConfig`, `validateConfig`, `withWebhookUrl` from `../workflow/builder`, import `TelnyxAssistantClient` from `../workflow/client`. After edge URL extraction: load config, validate (abort if errors), inject `${edgeUrl}/webhook` as the webhook URL, check `.telnyx/assistant.json` for cached ID (create if absent, update if present), write assistant ID to `.telnyx/assistant.json` after create. Print the assistant ID and test guidance. Verify by running `npx tsc --noEmit` and confirming the script compiles.
- [x] 7.2 Create `scripts/deploy-assistant.ts` as a standalone script: parse `--webhook-url` flag from `process.argv`, load config, validate, inject webhook URL (from flag, or from `.telnyx/assistant.json` cached edge URL, or error if neither exists), push to Telnyx API via `TelnyxAssistantClient`. Print the assistant ID. Verify by running `npx tsc --noEmit` and confirming the script compiles. Verify the no-URL error path works: `npx tsx scripts/deploy-assistant.ts` (without `--webhook-url` and without caches) prints a clear error and exits non-zero.

## 8. Integration Verification

- [x] 8.1 Run `npx tsc --noEmit` from the repo root and confirm zero type errors across `scripts/` and `workflow/`.
- [x] 8.2 Run `cd edge && npm run test` and confirm all webhook tests pass with the new response shape.
- [x] 8.3 Run `cd edge && npm run lint` and confirm no lint errors.
- [x] 8.4 Verify the full set of new files exists: `workflow/assistant.config.json`, `workflow/types.ts`, `workflow/builder.ts`, `workflow/client.ts`, `scripts/deploy-assistant.ts`. Verify the modified files contain the expected changes: `scripts/deploy.ts` (assistant phase), `edge/src/webhook.ts` (wrapped response), `edge/tests/webhook.test.ts` (updated assertions), `tsconfig.json` (workflow include), `package.json` (telnyx dep + script), `.gitignore` (.telnyx/assistant.json).
