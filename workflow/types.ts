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

import type { FlowNodeReq, SpeakNodeReq, ToolNodeReq } from "telnyx/resources/ai";
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
