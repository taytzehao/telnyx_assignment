/*
 * SDK type inspection findings (task 2.1):
 *
 * The `telnyx` SDK (^7.25.0) exports granular types for the Assistants API
 * under the `telnyx/resources/ai` subpath (not from the root `telnyx` import):
 *
 * Methods (on `client.ai.assistants`):
 *   create(params: AssistantCreateParams, options?: RequestOptions) → InferenceEmbedding
 *   update(assistantID: string, body: AssistantUpdateParams, options?) → InferenceEmbedding
 *   retrieve(assistantID: string, query?: AssistantRetrieveParams, options?) → InferenceEmbedding
 *
 * RequestOptions (from `telnyx`) has `idempotencyKey?: string`.
 *
 * Key exported types (from `telnyx/resources/ai`):
 *   AssistantCreateParams   — create request payload (required: name, instructions)
 *   AssistantUpdateParams    — update request payload (all optional)
 *   InferenceEmbedding       — the assistant response object (includes id, created_at, model, ...)
 *   ConversationFlowReq      — workflow graph request shape (start_node_id, nodes, edges)
 *   FlowNodeReq              — prompt node request (id, instructions, instructions_mode?, model?, ...)
 *   SpeakNodeReq             — speak node request (id, message, name?, type: "speak")
 *   ToolNodeReq              — tool node request (id, shared_tool_id, message?, type: "tool")
 *   FlowEdge                 — edge with condition/target discriminated unions
 *   FlowEdge.LlmCondition    — { type: "llm", prompt: string }
 *   FlowEdge.ExpressionCondition — { type: "expression", expression: unknown }
 *   FlowEdge.DefaultCondition    — { type: "default" }
 *   FlowEdge.NodeTarget           — { type: "node", node_id: string }
 *   FlowEdge.AssistantTarget      — { type: "assistant", assistant_id: string, voice_mode? }
 *   Expression                — discriminated union for expression AST nodes
 *   ComparisonExpression     — { type: "comparison", left: unknown, op, right: unknown }
 *   EnabledFeatures           — "telephony" | "messaging"
 *   AssistantMcpServer       — { id: string, allowed_tools?: string[] }
 *
 * Field naming: all snake_case (matches the API wire format). No conversion needed.
 *
 * instructions_mode: SDK type comment says `replace` is the API default when omitted.
 * Our config convention sets "append" explicitly on prompt nodes (see design.md D7).
 */

// Re-export SDK types — no duplication
export type {
  AssistantCreateParams as CreateAssistantRequest,
  AssistantUpdateParams,
  InferenceEmbedding as Assistant,
  ConversationFlowReq as ConversationFlow,
  FlowNodeReq as PromptNode,
  SpeakNodeReq as SpeakNode,
  ToolNodeReq,
  FlowEdge as WorkflowEdge,
  EnabledFeatures,
  AssistantMcpServer as MCPServerRef,
} from "telnyx/resources/ai";

import type { FlowNodeReq, SpeakNodeReq, ToolNodeReq, AssistantMcpServer } from "telnyx/resources/ai";
import type { FlowEdge } from "telnyx/resources/ai";

// Discriminated union for workflow nodes (prompt / speak / tool)
export type WorkflowNode = FlowNodeReq | SpeakNodeReq | ToolNodeReq;

// Re-export edge condition and target types for direct access
export type LlmCondition = FlowEdge.LlmCondition;
export type ExpressionCondition = FlowEdge.ExpressionCondition;
export type DefaultCondition = FlowEdge.DefaultCondition;
export type EdgeCondition =
  | FlowEdge.LlmCondition
  | FlowEdge.ExpressionCondition
  | FlowEdge.DefaultCondition;

export type EdgeTarget = FlowEdge.NodeTarget | FlowEdge.AssistantTarget;

// Operand types for expression conditions
export type {
  Expression,
  ComparisonExpression,
} from "telnyx/resources/ai";

export type Operand =
  | { type: "variable"; name: string }
  | { type: "string_literal"; value: string }
  | { type: "number_literal"; value: number }
  | { type: "bool_literal"; value: boolean };

// Instructions mode — API defaults to "replace", our config sets "append" explicitly
export type InstructionsMode = "append" | "replace";

// ── Authoring (pre-resolution) config types ──────────────────────────────

/**
 * Composable prompt instructions: a single string or a list of `@prompt:<name>`
 * markers and/or plain strings that are joined at deploy time. The array form
 * lets the config compose shared fragments without duplicating prompt text —
 * resolved into a single string by `resolvePrompts` before the API call.
 */
export type ComposableInstructions = string | string[];

/** A workflow node in authoring (pre-resolution) form — `instructions` may be composable. */
export interface RawWorkflowNode {
  type?: string;
  id: string;
  name?: string;
  message?: string;
  instructions?: ComposableInstructions;
  instructions_mode?: "append" | "replace";
  shared_tool_ids?: string[];
  tools_mode?: string;
  shared_tool_id?: string;
}

/** The conversation flow in authoring (pre-resolution) form. */
export interface RawConversationFlow {
  start_node_id: string;
  nodes: RawWorkflowNode[];
  edges: FlowEdge[];
}

/**
 * Assistant config in authoring (pre-resolution) form.
 *
 * `instructions` fields (`top-level` and per `node`) may be a `string | string[]`:
 * an array of `@prompt:<name>` references and/or plain strings that are composed
 * (joined with `\n\n`) and resolved to a single string by `resolvePrompts`,
 * producing a `CreateAssistantRequest` for the Telnyx API.
 *
 * `CreateAssistantRequest` (the post-resolution SDK type with `string` instructions)
 * is assignable to `RawAssistantConfig`, so existing `validConfig()` fixtures
 * keep working without modification.
 */
export interface RawAssistantConfig {
  name: string;
  instructions: ComposableInstructions;
  model?: string;
  dynamic_variables_webhook_url?: string;
  dynamic_variables_webhook_timeout_ms?: number;
  enabled_features?: string[];
  mcp_servers?: AssistantMcpServer[];
  dynamic_variables?: Record<string, unknown>;
  conversation_flow?: RawConversationFlow;
  tool_ids?: string[];
}
