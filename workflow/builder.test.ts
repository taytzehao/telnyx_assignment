import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateConfig, withWebhookUrl, resolvePrompts } from "./builder";
import {
  ROOT_INSTRUCTIONS,
  CLINIC_ROLE,
  CONTROLLER_CONTRACT,
  VERIFY_CONTRACT,
  NODE_JOBS,
} from "./prompts";
import type { CreateAssistantRequest, RawAssistantConfig, WorkflowNode } from "./types";

function getInstructions(node: WorkflowNode): string | undefined {
  return "instructions" in node ? (node.instructions as string | undefined) : undefined;
}

function validConfig(): RawAssistantConfig {
  return {
    name: "test-assistant",
    instructions: "You are a test assistant.",
    conversation_flow: {
      start_node_id: "n_speak",
      nodes: [
        {
          type: "speak",
          id: "n_speak",
          name: "Greeting",
          message: "Hello there.",
        },
        {
          type: "prompt",
          id: "n_prompt",
          name: "Ask",
          instructions: "Ask what they need.",
          instructions_mode: "append",
        },
      ],
      edges: [
        {
          id: "e_speak_to_prompt",
          start_node_id: "n_speak",
          target: { type: "node", node_id: "n_prompt" },
          condition: { type: "default" },
        },
      ],
    },
  };
}

let passed = 0;
let total = 0;

function test(name: string, fn: () => void) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log("\nValidation tests:");

test("valid config passes", () => {
  const result = validateConfig(validConfig());
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.errors.length, 0);
});

test("missing start node rejected", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.start_node_id = "n_nonexistent";
  const result = validateConfig(cfg);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("n_nonexistent")));
});

test("speak node with zero default edges rejected", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.edges = [];
  const result = validateConfig(cfg);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("n_speak")));
});

test("speak node with multiple default edges rejected", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.edges = [
    {
      id: "e1",
      start_node_id: "n_speak",
      target: { type: "node", node_id: "n_prompt" },
      condition: { type: "default" },
    },
    {
      id: "e2",
      start_node_id: "n_speak",
      target: { type: "node", node_id: "n_prompt" },
      condition: { type: "default" },
    },
  ];
  const result = validateConfig(cfg);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("n_speak")));
});

test("duplicate node IDs rejected", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.nodes[1].id = "n_speak";
  const result = validateConfig(cfg);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("Duplicate node ID")));
});

test("edge to non-existent target rejected", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.edges![0].target = {
    type: "node",
    node_id: "n_ghost",
  };
  const result = validateConfig(cfg);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("n_ghost")));
});

test("withWebhookUrl injects URL", () => {
  const cfg = resolvePrompts(validConfig());
  const updated = withWebhookUrl(cfg, "https://example.test/webhook");
  assert.strictEqual(
    updated.dynamic_variables_webhook_url,
    "https://example.test/webhook",
  );
});

test("withWebhookUrl does not mutate original", () => {
  const cfg = resolvePrompts(validConfig());
  withWebhookUrl(cfg, "https://example.test/webhook");
  assert.strictEqual(cfg.dynamic_variables_webhook_url, undefined);
});

console.log("\nresolvePrompts tests:");

test("resolvePrompts expands a single @prompt:root marker into ROOT_INSTRUCTIONS", () => {
  const cfg = validConfig();
  cfg.instructions = "@prompt:root";
  const resolved = resolvePrompts(cfg);
  assert.strictEqual(resolved.instructions, ROOT_INSTRUCTIONS);
});

test("resolvePrompts composes an array of fragment markers (root-level)", () => {
  const cfg = validConfig();
  cfg.instructions = ["@prompt:clinic_role", "@prompt:controller_contract"];
  const resolved = resolvePrompts(cfg);
  assert.ok(resolved.instructions.includes(CLINIC_ROLE),
    "root must contain CLINIC_ROLE from the first array element");
  assert.ok(resolved.instructions.includes(CONTROLLER_CONTRACT),
    "root must contain CONTROLLER_CONTRACT from the second array element");
  assert.ok(resolved.instructions.includes("\n\n"),
    "array elements are joined with double newlines");
});

test("resolvePrompts handles mixed markers and plain strings in an array", () => {
  const cfg = validConfig();
  cfg.instructions = ["@prompt:clinic_role", "Be extra courteous today."];
  const resolved = resolvePrompts(cfg);
  assert.ok(resolved.instructions.includes(CLINIC_ROLE));
  assert.ok(resolved.instructions.includes("Be extra courteous today."));
});

test("resolvePrompts expands a single-marker array on a node", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.nodes[1].instructions = ["@prompt:n_intent"];
  const resolved = resolvePrompts(cfg);
  assert.strictEqual(
    getInstructions(resolved.conversation_flow!.nodes[1]),
    NODE_JOBS["n_intent"],
  );
});

test("resolvePrompts composes multiple fragments on a node array", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.nodes[1].instructions = ["@prompt:caller_context", "@prompt:n_intent"];
  const resolved = resolvePrompts(cfg);
  const instr = getInstructions(resolved.conversation_flow!.nodes[1])!;
  assert.ok(instr.includes(NODE_JOBS["n_intent"]), "must contain the node job");
  assert.ok(instr.includes("{{telnyx_end_user_target}}"), "must contain the caller_context fragment");
});

test("resolvePrompts leaves plain-string instructions untouched", () => {
  const cfg = validConfig();
  const original = cfg.conversation_flow!.nodes[1].instructions as string;
  const resolved = resolvePrompts(cfg);
  assert.strictEqual(getInstructions(resolved.conversation_flow!.nodes[1]), original);
});

test("resolvePrompts does not mutate the input config", () => {
  const cfg = validConfig();
  cfg.instructions = ["@prompt:clinic_role", "@prompt:controller_contract"];
  cfg.conversation_flow!.nodes[1].instructions = ["@prompt:n_intent"];
  resolvePrompts(cfg);
  assert.deepStrictEqual(cfg.instructions, ["@prompt:clinic_role", "@prompt:controller_contract"]);
  assert.deepStrictEqual(cfg.conversation_flow!.nodes[1].instructions, ["@prompt:n_intent"]);
});

test("resolvePrompts throws on an unknown marker in an array (workflow-drift guardrail)", () => {
  const cfg = validConfig();
  cfg.conversation_flow!.nodes[1].instructions = ["@prompt:n_does_not_exist"];
  assert.throws(
    () => resolvePrompts(cfg),
    /Unknown prompt marker/,
  );
});

test("every @prompt:<name> in the live assistant.config.json resolves", () => {
  const configPath = resolve("workflow/assistant.config.json");
  const raw = readFileSync(configPath, "utf-8");
  const cfg = JSON.parse(raw) as RawAssistantConfig;
  // Should not throw — every marker has a PROMPTS entry.
  const resolved = resolvePrompts(cfg);
  assert.ok(resolved.instructions.length > 0, "root instructions resolved");
  for (const node of resolved.conversation_flow!.nodes) {
    const instr = getInstructions(node);
    if (instr !== undefined) {
      assert.ok(
        !instr.startsWith("@prompt:"),
        `unresolved marker on ${node.id}: ${instr}`,
      );
    }
  }
});

test("live config uses array instructions at the root level", () => {
  const configPath = resolve("workflow/assistant.config.json");
  const raw = readFileSync(configPath, "utf-8");
  const cfg = JSON.parse(raw) as RawAssistantConfig;
  assert.ok(Array.isArray(cfg.instructions),
    "root instructions must be an array of composable prompt references");
  assert.ok(cfg.instructions.length >= 2,
    "root instructions should compose multiple shared fragments");
});

test("live config uses array instructions on every prompt node", () => {
  const configPath = resolve("workflow/assistant.config.json");
  const raw = readFileSync(configPath, "utf-8");
  const cfg = JSON.parse(raw) as RawAssistantConfig;
  for (const node of cfg.conversation_flow!.nodes) {
    if (node.instructions !== undefined) {
      assert.ok(Array.isArray(node.instructions),
        `node ${node.id} instructions must be an array`);
    }
  }
});

test("verify_contract is composed onto both verify nodes", () => {
  const configPath = resolve("workflow/assistant.config.json");
  const raw = readFileSync(configPath, "utf-8");
  const cfg = JSON.parse(raw) as RawAssistantConfig;
  for (const id of ["n_verify_create", "n_verify_cancel"]) {
    const node = cfg.conversation_flow!.nodes.find((n) => n.id === id);
    assert.ok(node, `node ${id} exists`);
    assert.ok(
      Array.isArray(node!.instructions) && node!.instructions.includes("@prompt:verify_contract"),
      `${id} must compose @prompt:verify_contract via its instructions array`,
    );
  }
  // Sanity: the resolved verify nodes contain both the shared contract and their snippet
  const resolved = resolvePrompts(cfg);
  for (const id of ["n_verify_create", "n_verify_cancel"]) {
    const node = resolved.conversation_flow!.nodes.find((n) => n.id === id)!;
    const instr = getInstructions(node)!;
    assert.ok(instr.includes(VERIFY_CONTRACT), `${id} resolved text must contain VERIFY_CONTRACT`);
    assert.ok(instr.includes(NODE_JOBS[id]), `${id} resolved text must contain its node job`);
  }
});

test("root instruction composes the workflow-wide controller contract", () => {
  const cfg = validConfig();
  cfg.instructions = ["@prompt:clinic_role", "@prompt:controller_contract"];
  const resolved = resolvePrompts(cfg);
  assert.ok(
    resolved.instructions.includes(CONTROLLER_CONTRACT),
    "ROOT_INSTRUCTIONS must include CONTROLLER_CONTRACT so the one-job-per-node rule applies to every node",
  );
});

if (!process.exitCode) {
  console.log(`\nAll ${passed}/${total} tests passed.`);
} else {
  console.log(`\n${passed}/${total} tests passed.`);
}

export {};
