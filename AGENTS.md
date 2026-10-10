# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Telnyx AI Assistant coding challenge — build a multi-step Voice AI assistant powered by Telnyx, backed by a custom MCP server, running on Telnyx Edge Compute, and developed with Telnyx Inference via the OpenCode plugin. Full spec: `code_challenge.md`.

## Stack

- **AI coding model**: Telnyx Inference via the `@telnyx/opencode` plugin (config in `.opencode/opencode.json`). Authenticate: `opencode auth login --provider telnyx --method "API Key"`. Current model families: `moonshotai/Kimi-K3`, `zai-org/GLM-5.x`, `deepseek-ai/DeepSeek-V4`, Qwen3.x — manage via the `/telnyx` TUI command or `~/.config/opencode/telnyx-models.json`.
- **Edge Compute** (required — NOT Vercel/Railway/Heroku):
  - Edge Functions — scaffold `telnyx-edge new-func <name> -l typescript`, deploy `telnyx-edge ship`.
  - KV (Key-Value Store) — via `env` binding (TypeScript only; REST API in other languages).
  - Stateful Actors — `@telnyx/edge-runtime`, single-threaded per-entity state for safe read-modify-write.
- **MCP server** — any language/framework; must be publicly reachable by the assistant.
- **Languages**: TypeScript, JavaScript, Go, Python, or Java.

## Core Requirements (all required)

1. **AI Assistant + Conversation Workflow** — multiple prompt nodes + ≥1 speak node (verbatim/compliance); conditional edges using both LLM conditions and variable comparisons; callable via phone.
2. **MCP server** — expose ≥3 tools that workflow nodes call.
3. **Dynamic Webhook Variables** — webhook endpoint must be a Telnyx Edge Function; use dynamic data to personalize and influence routing.
4. **Edge Compute deployment** — all backends on Telnyx Edge via `telnyx-edge ship`.
5. **Observability** — structured logging on every webhook call (caller, node, outcome) plus ≥1 signal beyond logs (counter, latency, or trace).
6. **Telnyx Inference via OpenCode** — build the whole solution with a Telnyx-hosted model (dogfooding).
7. **Public deployment & docs** — working URLs + test phone number; MCP server public.

## Commands

```bash
# Deploy an Edge Function (never use Vercel/Railway/Heroku)
telnyx-edge ship

# Run a Telnyx-hosted model
opencode run --model 'telnyx/moonshotai/Kimi-K3' '...'

# Verify stored credential
opencode auth list
```

No `lint` / `typecheck` / `test` scripts exist yet — add them when the project scaffolds and run them before every commit.

## Conventions & Constraints

- **Secrets**: `.env` holds `TELNYX_API_KEY` and is gitignored. Never commit or log keys; read from process env, not hardcoded.
- **Deployment target**: Telnyx Edge Compute only. Do not add Vercel/Railway/Heroku configs.
- **Pick the right primitive per job**: Stateful Actors for single-threaded read-modify-write on one entity; KV for cache/session/flags; plain function logic otherwise. Don't shoehorn Actors everywhere.
- **Speak nodes** for verbatim/compliance messages; **prompt nodes** for LLM-driven steps.
- **Scope tools per workflow node** — fewer tools = more reliable tool calls.
- **Instrument as you go** — add structured logs up front, not after something breaks.
- **Test every workflow path** — happy, fallback, escalation, and ≥1 negative case per important node.

## Key Docs

- Edge Compute: https://developers.telnyx.com/docs/edge-compute/overview
- Stateful Actors: https://developers.telnyx.com/docs/edge-compute/stateful-actors
- KV: https://developers.telnyx.com/docs/edge-compute/kv
- Conversation Workflows: https://developers.telnyx.com/docs/inference/ai-assistants/workflows
- Dynamic Variables: https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables
- AI Assistants API: https://developers.telnyx.com/api-reference/assistants/create-an-assistant
- MCP spec: https://modelcontextprotocol.io/
