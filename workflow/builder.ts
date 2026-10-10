import { readFileSync } from "node:fs";
import type { CreateAssistantRequest } from "./types";

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

export function loadConfig(path: string): CreateAssistantRequest {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as CreateAssistantRequest;
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

export function validateConfig(config: CreateAssistantRequest): ValidationResult {
  const errors: string[] = [];

  if (!config.name) {
    errors.push("Missing required field: name");
  }
  if (!config.instructions) {
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
