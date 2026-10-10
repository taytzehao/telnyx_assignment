import assert from "node:assert";
import { TelnyxAssistantClient } from "./client";

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

function testThrows(name: string, fn: () => void) {
  total++;
  try {
    fn();
    console.error(`  \u2717 ${name}: expected throw, but did not`);
    process.exitCode = 1;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("TELNYX_API_KEY")) {
      passed++;
      console.log(`  \u2713 ${name}`);
    } else {
      console.error(`  \u2717 ${name}: unexpected error: ${msg}`);
      process.exitCode = 1;
    }
  }
}

console.log("\nClient tests:");

test("constructor succeeds when apiKey is provided", () => {
  const c = new TelnyxAssistantClient("test-key");
  assert.ok(c);
  assert.strictEqual(typeof c.create, "function");
  assert.strictEqual(typeof c.update, "function");
  assert.strictEqual(typeof c.retrieve, "function");
});

test("constructor reads TELNYX_API_KEY from env", () => {
  const oldKey = process.env.TELNYX_API_KEY;
  process.env.TELNYX_API_KEY = "env-key-12345";
  try {
    const c = new TelnyxAssistantClient();
    assert.ok(c);
  } finally {
    if (oldKey !== undefined) {
      process.env.TELNYX_API_KEY = oldKey;
    } else {
      delete process.env.TELNYX_API_KEY;
    }
  }
});

test("constructor throws when TELNYX_API_KEY is not set", () => {
  const oldKey = process.env.TELNYX_API_KEY;
  delete process.env.TELNYX_API_KEY;
  try {
    testThrows("throws when key missing", () => {
      new TelnyxAssistantClient();
    });
  } finally {
    if (oldKey !== undefined) {
      process.env.TELNYX_API_KEY = oldKey;
    }
  }
});

test("explicit apiKey takes precedence over env", () => {
  const oldKey = process.env.TELNYX_API_KEY;
  process.env.TELNYX_API_KEY = "env-key";
  try {
    const c = new TelnyxAssistantClient("explicit-key");
    assert.ok(c);
  } finally {
    if (oldKey !== undefined) {
      process.env.TELNYX_API_KEY = oldKey;
    } else {
      delete process.env.TELNYX_API_KEY;
    }
  }
});

if (!process.exitCode) {
  console.log(`\nAll ${passed}/${total} tests passed.`);
} else {
  console.log(`\n${passed}/${total} tests passed.`);
}

export {};
