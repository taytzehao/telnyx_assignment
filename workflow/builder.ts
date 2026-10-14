import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CreateAssistantRequest, RawAssistantConfig } from "./types";
import { resolveInstructions } from "./prompts";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isSpeakNode(node: { type?: string }): boolean {
  return node.type === "speak";
}

function isToolNode(node: { type?: string }): boolean {
  return node.type === "tool";
}

export function loadConfig(path: string): RawAssistantConfig {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as RawAssistantConfig;
}

/**
 * Resolve every composable `instructions` field (top-level and per-node) into
 * the final string the Telnyx API expects.
 *
 * The assistant config stores prompt *references* — a single `@prompt:<name>`
 * string or an **array** of such markers / plain strings — instead of
 * duplicated prompt text. `instructions` fields are resolved via
 * {@link resolveInstructions} (which composes arrays into a single string),
 * producing a `CreateAssistantRequest` with plain-string instructions.
 *
 * Array composition is the key mechanism: the root `instructions` can list
 * shared fragments (`["@prompt:clinic_role", "@prompt:controller_contract", …]`)
 * that apply to every node via `instructions_mode: "append"`, and each node
 * can list its own job plus any extra fragments it needs — all without
 * duplicating prompt text across the config.
 *
 * Plain-string instructions pass through untouched, so the unit-test
 * fixtures (which use literal strings) keep working without markers.
 *
 * @throws if any `@prompt:` marker references an unknown name — the
 *   workflow-drift guardrail that catches a new node without a prompt entry.
 */
export function resolvePrompts(
  config: RawAssistantConfig,
): CreateAssistantRequest {
  const next: RawAssistantConfig = { ...config };

  next.instructions = resolveInstructions(config.instructions);

  if (next.conversation_flow) {
    next.conversation_flow = {
      ...next.conversation_flow,
      nodes: next.conversation_flow.nodes.map((node) => {
        if (node.instructions === undefined) return node;
        return { ...node, instructions: resolveInstructions(node.instructions) };
      }),
    };
  }

  return next as unknown as CreateAssistantRequest;
}

/**
 * Write the resolved `conversation_flow` to the snapshot file the eval
 * coverage guardrail reads (`assistant/conversation-flow.json`). Keeping
 * the snapshot in sync with the deployed config means the guardrail audits
 * the same prompts the live assistant uses — never a stale snapshot.
 */
export function writeFlowSnapshot(
  config: CreateAssistantRequest,
  snapshotPath: string,
): void {
  const fullPath = resolve(snapshotPath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const payload = { conversation_flow: config.conversation_flow };
  writeFileSync(fullPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

export function withWebhookUrl(
  config: CreateAssistantRequest,
  url: string,
): CreateAssistantRequest {
  return { ...config, dynamic_variables_webhook_url: url };
}

export function withMcpServer(
  config: CreateAssistantRequest,
  serverId: string,
): CreateAssistantRequest {
  return { ...config, mcp_servers: [{ id: serverId }] };
}

export function withSharedToolIds(
  config: CreateAssistantRequest,
  toolIds: string[],
): CreateAssistantRequest {
  return { ...config, tool_ids: toolIds };
}

export function validateConfig(config: RawAssistantConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.name) {
    errors.push("Missing required field: name");
  }
  if (
    !config.instructions ||
    (Array.isArray(config.instructions) && config.instructions.length === 0)
  ) {
    errors.push("Missing required field: instructions");
  }

  const flow = config.conversation_flow;
  if (!flow) {
    return { ok: errors.length === 0, errors };
  }

  const nodeIds = new Set<string>();
  const nodeSet = new Set<string>();
  for (const node of flow.nodes) {
    if (!node.id) {
      errors.push("Node missing required field: id");
      continue;
    }
    if (nodeSet.has(node.id)) {
      errors.push(`Duplicate node ID: ${node.id}`);
    }
    nodeSet.add(node.id);
    nodeIds.add(node.id);
  }

  if (!flow.start_node_id) {
    errors.push("Missing required field: conversation_flow.start_node_id");
  } else if (!nodeIds.has(flow.start_node_id)) {
    errors.push(
      `start_node_id "${flow.start_node_id}" does not match any node`,
    );
  }

  const edgeIds = new Set<string>();
  for (const edge of flow.edges ?? []) {
    if (!edge.id) {
      errors.push("Edge missing required field: id");
      continue;
    }
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge ID: ${edge.id}`);
    }
    edgeIds.add(edge.id);

    if (!edge.start_node_id) {
      errors.push(`Edge ${edge.id} missing start_node_id`);
    } else if (!nodeIds.has(edge.start_node_id)) {
      errors.push(
        `Edge ${edge.id} references non-existent start node: ${edge.start_node_id}`,
      );
    }

    if (
      edge.target?.type === "node" &&
      edge.target.node_id &&
      !nodeIds.has(edge.target.node_id)
    ) {
      errors.push(
        `Edge ${edge.id} targets non-existent node: ${edge.target.node_id}`,
      );
    }
  }

  const outgoingByNode = new Map<string, typeof flow.edges>();
  for (const edge of flow.edges ?? []) {
    const key = edge.start_node_id;
    if (!key) continue;
    const arr = outgoingByNode.get(key) ?? [];
    arr.push(edge);
    outgoingByNode.set(key, arr);
  }

  for (const node of flow.nodes) {
    if (!node.id) continue;
    const outgoing = outgoingByNode.get(node.id) ?? [];
    const defaultEdges = outgoing.filter(
      (e) => e.condition?.type === "default",
    );

    if (isSpeakNode(node)) {
      if (defaultEdges.length !== 1) {
        errors.push(
          `Speak node "${node.id}" must have exactly one outgoing default edge (found ${defaultEdges.length})`,
        );
      }
    }

    if (isToolNode(node) && outgoing.length > 0 && defaultEdges.length !== 1) {
      errors.push(
        `Tool node "${node.id}" with outgoing edges must have exactly one default edge (found ${defaultEdges.length})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
