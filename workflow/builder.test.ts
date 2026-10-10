import assert from "node:assert";
import { validateConfig, withWebhookUrl } from "./builder";
import type { CreateAssistantRequest } from "./types";

function validConfig(): CreateAssistantRequest {
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
  const cfg = validConfig();
  const updated = withWebhookUrl(cfg, "https://example.test/webhook");
  assert.strictEqual(
    updated.dynamic_variables_webhook_url,
    "https://example.test/webhook",
  );
});

test("withWebhookUrl does not mutate original", () => {
  const cfg = validConfig();
  withWebhookUrl(cfg, "https://example.test/webhook");
  assert.strictEqual(cfg.dynamic_variables_webhook_url, undefined);
});

if (!process.exitCode) {
  console.log(`\nAll ${passed}/${total} tests passed.`);
} else {
  console.log(`\n${passed}/${total} tests passed.`);
}

export {};
