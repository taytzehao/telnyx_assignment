import assert from "node:assert";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { EvalClient } from "./client";
import { EvalRunner } from "./runner";
import { EdgeCallerState, testCallerId } from "./caller-state";
import { composeScenarioInstructions, defineScenario, SCENARIO_FRAGMENTS, SEEDS } from "./scenario-prompts";
import { handleRequestScenario } from "./scenarios";
import { allClinicScenarios, HIGH_VALUE_BRANCHING_NODES } from "./clinic-scenarios";

let passed = 0;
let total = 0;

function testSync(name: string, fn: () => void): void {
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

async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function runAll(): Promise<void> {
  console.log("\nEvalClient tests:");

  testSync("constructor succeeds when apiKey is provided", () => {
    const c = new EvalClient("test-key");
    assert.ok(c);
    assert.strictEqual(typeof c.createTest, "function");
    assert.strictEqual(typeof c.updateTest, "function");
    assert.strictEqual(typeof c.triggerRun, "function");
    assert.strictEqual(typeof c.getRun, "function");
  });

  testSync("constructor reads TELNYX_API_KEY from env", () => {
    const oldKey = process.env.TELNYX_API_KEY;
    process.env.TELNYX_API_KEY = "env-key-12345";
    try {
      const c = new EvalClient();
      assert.ok(c);
    } finally {
      if (oldKey !== undefined) {
        process.env.TELNYX_API_KEY = oldKey;
      } else {
        delete process.env.TELNYX_API_KEY;
      }
    }
  });

  testSync("constructor throws when TELNYX_API_KEY is not set", () => {
    const oldKey = process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_API_KEY;
    try {
      total++;
      new EvalClient();
      console.error(`  \u2717 throws when key missing: expected throw, but did not`);
      process.exitCode = 1;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("TELNYX_API_KEY")) {
        passed++;
        console.log(`  \u2713 throws when key missing`);
      } else {
        console.error(`  \u2717 throws when key missing: unexpected error: ${msg}`);
        process.exitCode = 1;
      }
    } finally {
      if (oldKey !== undefined) {
        process.env.TELNYX_API_KEY = oldKey;
      } else {
        delete process.env.TELNYX_API_KEY;
      }
    }
  });

  testSync("explicit apiKey takes precedence over env", () => {
    const oldKey = process.env.TELNYX_API_KEY;
    process.env.TELNYX_API_KEY = "env-key";
    try {
      const c = new EvalClient("explicit-key");
      assert.ok(c);
    } finally {
      if (oldKey !== undefined) {
        process.env.TELNYX_API_KEY = oldKey;
      } else {
        delete process.env.TELNYX_API_KEY;
      }
    }
  });

  console.log("\nEvalRunner tests:");

  await testAsync("cache miss creates and caches the test ID", async () => {
    const cachePath = ".telnyx/eval-test-miss.json";
    if (existsSync(cachePath)) unlinkSync(cachePath);

    let createCallCount = 0;
    const mockClient = {
      createTest: async () => {
        createCallCount++;
        return { test_id: "test-new-id", name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const };
      },
      triggerRun: async () => {
        return { run_id: "run-1", test_id: "test-new-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async (_testId: string, _runId: string) => {
        return { run_id: "run-1", test_id: "test-new-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
    };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, {
      cachePath,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    const { testRun } = await runner.run({ ...handleRequestScenario, destination: "+10000000000" });
    assert.strictEqual(createCallCount, 1);
    assert.strictEqual(testRun.status, "passed");

    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    assert.strictEqual(cache["Routing: Handle Request"], "test-new-id");
    unlinkSync(cachePath);
  });

  await testAsync("cache hit syncs the test definition, skips creation, and triggers", async () => {
    const cachePath = ".telnyx/eval-test-hit.json";
    writeFileSync(cachePath, JSON.stringify({ "Routing: Handle Request": "test-cached-id" }));

    let createCallCount = 0;
    const updated: { testId: string; instructions: string }[] = [];
    const mockClient = {
      updateTest: async (testId: string, scenario: { instructions: string }) => {
        updated.push({ testId, instructions: scenario.instructions });
        return { test_id: testId, name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const };
      },
      createTest: async () => {
        createCallCount++;
        return { test_id: "should-not-be-called", name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const };
      },
      triggerRun: async (_testId: string) => {
        return { run_id: "run-2", test_id: "test-cached-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async (_testId: string, _runId: string) => {
        return { run_id: "run-2", test_id: "test-cached-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
    };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, {
      cachePath,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    const { testRun } = await runner.run({ ...handleRequestScenario, destination: "+10000000000" });
    assert.strictEqual(createCallCount, 0, "createTest should not be called when cache hit");
    assert.deepStrictEqual(updated, [{ testId: "test-cached-id", instructions: handleRequestScenario.instructions }],
      "the cached test must be updated with the current scenario before triggering");
    assert.strictEqual(testRun.status, "passed");
    unlinkSync(cachePath);
  });

  await testAsync("a 404 while syncing a cached test recreates it", async () => {
    const cachePath = ".telnyx/eval-test-sync-404.json";
    writeFileSync(cachePath, JSON.stringify({ "Routing: Handle Request": "test-deleted-id" }));

    let createCallCount = 0;
    const triggered: string[] = [];
    const mockClient = {
      updateTest: async () => {
        throw new Error("404 Not Found: test does not exist");
      },
      createTest: async () => {
        createCallCount++;
        return { test_id: "test-fresh-id", name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const };
      },
      triggerRun: async (testId: string) => {
        triggered.push(testId);
        return { run_id: "run-4", test_id: testId, status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async (_testId: string, _runId: string) => {
        return { run_id: "run-4", test_id: "test-fresh-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
    };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, {
      cachePath,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    await runner.run({ ...handleRequestScenario, destination: "+10000000000" });

    assert.strictEqual(createCallCount, 1, "createTest should be called once");
    assert.deepStrictEqual(triggered, ["test-fresh-id"], "only the recreated test is triggered");
    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    assert.strictEqual(cache["Routing: Handle Request"], "test-fresh-id");
    unlinkSync(cachePath);
  });

  await testAsync("recreate-on-404 creates a new test and updates cache", async () => {
    const cachePath = ".telnyx/eval-test-stale.json";
    writeFileSync(cachePath, JSON.stringify({ "Routing: Handle Request": "test-old-id" }));

    let triggerCallCount = 0;
    let createCallCount = 0;
    const mockClient = {
      updateTest: async (testId: string) => ({ test_id: testId, name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const }),
      createTest: async () => {
        createCallCount++;
        return { test_id: "test-recreated-id", name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const };
      },
      triggerRun: async (_testId: string) => {
        triggerCallCount++;
        if (triggerCallCount === 1) {
          throw new Error("404 Not Found: test does not exist");
        }
        return { run_id: "run-3", test_id: "test-recreated-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async (_testId: string, _runId: string) => {
        return { run_id: "run-3", test_id: "test-recreated-id", status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
    };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, {
      cachePath,
      pollIntervalMs: 10,
      timeoutMs: 5000,
    });
    const { testRun } = await runner.run({ ...handleRequestScenario, destination: "+10000000000" });

    assert.strictEqual(createCallCount, 1, "createTest should be called once");
    assert.strictEqual(triggerCallCount, 2, "triggerRun should be called twice (first 404, second success)");
    assert.strictEqual(testRun.status, "passed");

    const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
    assert.strictEqual(cache["Routing: Handle Request"], "test-recreated-id");
    unlinkSync(cachePath);
  });

  console.log("\nCaller state tests:");

  const seeded = {
    ...handleRequestScenario,
    destination: "+10000000000",
    seed_appointments: [{ date: "2027-01-15", start_time: "10:00" }],
  };

  await testAsync("runner prepares the test caller with the scenario's seeds before triggering", async () => {
    const cachePath = ".telnyx/eval-test-seed.json";
    writeFileSync(cachePath, JSON.stringify({ "Routing: Handle Request": "test-seed-id" }));
    const events: string[] = [];
    const mockClient = {
      updateTest: async (testId: string) => ({ test_id: testId, name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const }),
      createTest: async () => { throw new Error("should not be called"); },
      triggerRun: async (testId: string) => {
        events.push(`trigger ${testId}`);
        return { run_id: "run-5", test_id: testId, status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async () => ({ run_id: "run-5", test_id: "test-seed-id", status: "passed" as const, triggered_by: "manual", created_at: "" }),
    };
    const callerState = {
      prepare: async (callerId: string, seeds: { date: string; start_time: string }[]) => {
        events.push(`prepare ${callerId} ${JSON.stringify(seeds)}`);
      },
    };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, { cachePath, pollIntervalMs: 10, timeoutMs: 5000, callerState });
    await runner.run(seeded);
    assert.deepStrictEqual(events, [
      `prepare ai-assistant-test-test-seed-id ${JSON.stringify(seeded.seed_appointments)}`,
      "trigger test-seed-id",
    ]);
    unlinkSync(cachePath);
  });

  await testAsync("runner re-prepares the recreated test's caller after a trigger 404", async () => {
    const cachePath = ".telnyx/eval-test-seed-404.json";
    writeFileSync(cachePath, JSON.stringify({ "Routing: Handle Request": "test-stale-id" }));
    const prepared: string[] = [];
    let triggers = 0;
    const mockClient = {
      updateTest: async (testId: string) => ({ test_id: testId, name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const }),
      createTest: async () => ({ test_id: "test-new-id", name: "test", rubric: [], created_at: "", telnyx_conversation_channel: "web_chat" as const }),
      triggerRun: async (testId: string) => {
        if (triggers++ === 0) throw new Error("404 Not Found");
        return { run_id: "run-6", test_id: testId, status: "passed" as const, triggered_by: "manual", created_at: "" };
      },
      getRun: async () => ({ run_id: "run-6", test_id: "test-new-id", status: "passed" as const, triggered_by: "manual", created_at: "" }),
    };
    const callerState = { prepare: async (callerId: string) => { prepared.push(callerId); } };
    const runner = new EvalRunner(mockClient as unknown as EvalClient, { cachePath, pollIntervalMs: 10, timeoutMs: 5000, callerState });
    await runner.run(seeded);
    assert.deepStrictEqual(prepared, [testCallerId("test-stale-id"), testCallerId("test-new-id")]);
    unlinkSync(cachePath);
  });

  await testAsync("runner refuses a seeded scenario without a callerState", async () => {
    const runner = new EvalRunner({} as unknown as EvalClient, { cachePath: ".telnyx/eval-test-unused.json" });
    await assert.rejects(() => runner.run(seeded), /needs seed_appointments/);
  });

  await testAsync("EdgeCallerState clears existing appointments, then creates the seeds", async () => {
    const calls: { url: string; header: string | null; body: unknown }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ url, header: headers.get("x-end-user-target"), body: JSON.parse(String(init.body)) });
      const payload = url.endsWith("/tools/list-appointments")
        ? { appointments: [{ id: "appt-a" }, { id: "appt-b" }] }
        : { success: true };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;
    await new EdgeCallerState("https://edge.test/", fakeFetch).prepare("ai-assistant-test-x", seeded.seed_appointments);
    assert.deepStrictEqual(calls.map((c) => [c.url, c.body]), [
      ["https://edge.test/tools/list-appointments", {}],
      ["https://edge.test/tools/cancel-appointments", { cancel_by: "id", appointment_id: "appt-a" }],
      ["https://edge.test/tools/cancel-appointments", { cancel_by: "id", appointment_id: "appt-b" }],
      ["https://edge.test/tools/create-appointment", { date: "2027-01-15", start_time: "10:00" }],
    ]);
    assert.ok(calls.every((c) => c.header === "ai-assistant-test-x"), "every call carries the caller header");
  });

  await testAsync("EdgeCallerState fails loudly when the edge rejects a seed", async () => {
    const fakeFetch = (async (url: string) =>
      url.endsWith("/tools/list-appointments")
        ? new Response(JSON.stringify({ appointments: [] }), { status: 200 })
        : new Response(JSON.stringify({ success: false, conflict: true }), { status: 409 })) as unknown as typeof fetch;
    await assert.rejects(
      () => new EdgeCallerState("https://edge.test", fakeFetch).prepare("ai-assistant-test-x", seeded.seed_appointments),
      /create-appointment returned HTTP 409/,
    );
  });

  console.log("\nScenario composition tests:");

  testSync("composes markers and plain text in order, joined with spaces", () => {
    assert.strictEqual(
      composeScenarioInstructions(["@scenario:caller_role", "Ask about hours."]),
      `${SCENARIO_FRAGMENTS.caller_role} Ask about hours.`,
    );
  });

  testSync("describes one seeded appointment from its spoken form", () => {
    assert.strictEqual(
      composeScenarioInstructions(["@scenario:seeded_appointments"], [SEEDS.jan15]),
      `You have an appointment on ${SEEDS.jan15.spoken}.`,
    );
  });

  testSync("describes several seeded appointments as a list", () => {
    assert.strictEqual(
      composeScenarioInstructions(["@scenario:seeded_appointments"], [SEEDS.jan15, SEEDS.jan20]),
      `You have two appointments: ${SEEDS.jan15.spoken} and ${SEEDS.jan20.spoken}.`,
    );
  });

  testSync("rejects @scenario:seeded_appointments when the scenario has no seeds", () => {
    assert.throws(() => composeScenarioInstructions(["@scenario:seeded_appointments"]), /no seed_appointments/);
  });

  testSync("rejects an unknown @scenario: marker", () => {
    assert.throws(() => composeScenarioInstructions(["@scenario:nope"]), /Unknown scenario marker/);
  });

  testSync("defineScenario sends only date and start_time for each seed", () => {
    const scenario = defineScenario({
      ...handleRequestScenario,
      instructions: ["@scenario:caller_role", "@scenario:seeded_appointments"],
      seed_appointments: [SEEDS.jun10],
    });
    assert.deepStrictEqual(scenario.seed_appointments, [{ date: SEEDS.jun10.date, start_time: SEEDS.jun10.start_time }]);
    assert.ok(scenario.instructions.includes(SEEDS.jun10.spoken));
  });

  testSync("no clinic scenario is left with an unresolved @scenario: marker", () => {
    for (const scenario of allClinicScenarios) {
      assert.ok(!scenario.instructions.includes("@scenario:"), `unresolved marker in "${scenario.name}"`);
    }
  });

  console.log("\nScenario tests:");

  testSync("boilerplate scenario has correct structure", () => {
    assert.ok(handleRequestScenario.name, "scenario has a name");
    assert.ok(handleRequestScenario.instructions, "scenario has instructions");
    assert.ok(handleRequestScenario.rubric.length >= 1, "scenario has at least one rubric item");
    assert.strictEqual(handleRequestScenario.telnyx_conversation_channel, "web_chat");
    assert.strictEqual(handleRequestScenario.test_suite, "workflow-routing");
  });

  console.log("\nClinic scenario count tests:");

  testSync("allClinicScenarios has 23 scenarios", () => {
    assert.strictEqual(allClinicScenarios.length, 23, `expected 23 scenarios, got ${allClinicScenarios.length}`);
  });

  testSync("clinic-routing suite has 16 scenarios", () => {
    const routing = allClinicScenarios.filter((s) => s.test_suite === "clinic-routing");
    assert.strictEqual(routing.length, 16, `expected 16 routing scenarios, got ${routing.length}`);
  });

  testSync("clinic-appointment-lifecycle suite has 1 scenario", () => {
    const lifecycle = allClinicScenarios.filter((s) => s.test_suite === "clinic-appointment-lifecycle");
    assert.strictEqual(lifecycle.length, 1, `expected 1 lifecycle scenario, got ${lifecycle.length}`);
  });

  testSync("clinic-edge-cases suite has 6 scenarios", () => {
    const edgeCases = allClinicScenarios.filter((s) => s.test_suite === "clinic-edge-cases");
    assert.strictEqual(edgeCases.length, 6, `expected 6 edge-case scenarios, got ${edgeCases.length}`);
  });

  console.log("\nScenario shape validation tests:");

  const VALID_CHANNELS = ["web_chat", "phone_call", "web_call", "sms_chat"];

  for (const scenario of allClinicScenarios) {
    testSync(`shape: "${scenario.name}" has non-empty name`, () => {
      assert.ok(scenario.name && scenario.name.length > 0, "name must be non-empty");
    });

    testSync(`shape: "${scenario.name}" has non-empty instructions`, () => {
      assert.ok(scenario.instructions && scenario.instructions.length > 0, "instructions must be non-empty");
    });

    testSync(`shape: "${scenario.name}" has valid rubric`, () => {
      assert.ok(scenario.rubric.length >= 1, "rubric must have at least one item");
      for (const item of scenario.rubric) {
        assert.ok(item.name && item.name.length > 0, `rubric item name must be non-empty in "${scenario.name}"`);
        assert.ok(item.criteria && item.criteria.length > 0, `rubric item criteria must be non-empty in "${scenario.name}"`);
      }
    });

    testSync(`shape: "${scenario.name}" has valid channel`, () => {
      assert.ok(
        VALID_CHANNELS.includes(scenario.telnyx_conversation_channel as string),
        `channel "${scenario.telnyx_conversation_channel}" is not valid for "${scenario.name}"`,
      );
    });

    testSync(`shape: "${scenario.name}" has non-empty test_suite`, () => {
      assert.ok(scenario.test_suite && scenario.test_suite.length > 0, "test_suite must be non-empty");
    });

    testSync(`shape: "${scenario.name}" seed_appointments are future slots within opening hours`, () => {
      const today = new Date().toISOString().slice(0, 10);
      for (const seed of scenario.seed_appointments ?? []) {
        assert.match(seed.date, /^\d{4}-\d{2}-\d{2}$/, `bad seed date ${seed.date}`);
        assert.ok(seed.date > today, `seed date ${seed.date} must be in the future`);
        assert.match(seed.start_time, /^(09|1[0-6]):(00|30)$/, `seed start_time ${seed.start_time} must be a 30-minute slot from 09:00 to 16:30`);
      }
    });

    testSync(`shape: "${scenario.name}" target_edge_ids valid if present`, () => {
      if (scenario.target_edge_ids !== undefined) {
        assert.ok(
          scenario.target_edge_ids.length >= 1,
          `target_edge_ids must have at least one entry in "${scenario.name}"`,
        );
      }
    });
  }

  console.log("\nCoverage guardrail tests:");

  testSync("all high-value LLM edges in assistant.config.json are covered", () => {
    const flowPath = resolve("workflow/assistant.config.json");
    const flowRaw = readFileSync(flowPath, "utf-8");
    const flow = JSON.parse(flowRaw) as {
      conversation_flow: {
        edges: Array<{
          id: string;
          start_node_id: string;
          condition: { type: string };
        }>;
      };
    };

    const highValueLlmEdges = flow.conversation_flow.edges
      .filter(
        (e) =>
          e.condition.type === "llm" &&
          HIGH_VALUE_BRANCHING_NODES.has(e.start_node_id),
      )
      .map((e) => e.id);

    assert.ok(highValueLlmEdges.length === 16, `expected 16 high-value LLM edges, got ${highValueLlmEdges.length}`);

    const coveredEdgeIds = new Set(
      allClinicScenarios.flatMap((s) => s.target_edge_ids ?? []),
    );

    const uncovered: string[] = [];
    for (const edgeId of highValueLlmEdges) {
      if (!coveredEdgeIds.has(edgeId)) {
        uncovered.push(edgeId);
      }
    }

    assert.strictEqual(
      uncovered.length,
      0,
      `Uncovered high-value LLM edges: ${uncovered.join(", ")}. Add scenarios with target_edge_ids covering these edges.`,
    );
  });

  testSync("non-LLM edges are not required for coverage", () => {
    const flowPath = resolve("workflow/assistant.config.json");
    const flowRaw = readFileSync(flowPath, "utf-8");
    const flow = JSON.parse(flowRaw) as {
      conversation_flow: {
        edges: Array<{
          id: string;
          start_node_id: string;
          condition: { type: string };
        }>;
      };
    };

    const nonLlmEdges = flow.conversation_flow.edges.filter(
      (e) => e.condition.type !== "llm",
    );

    const coveredEdgeIds = new Set(
      allClinicScenarios.flatMap((s) => s.target_edge_ids ?? []),
    );

    for (const edge of nonLlmEdges) {
      if (coveredEdgeIds.has(edge.id)) {
        continue;
      }
    }

    assert.ok(nonLlmEdges.length > 0, "expected at least one non-LLM edge in the workflow");
  });

  if (!process.exitCode) {
    console.log(`\nAll ${passed}/${total} tests passed.`);
  } else {
    console.log(`\n${passed}/${total} tests passed.`);
  }
}

runAll();

export {};
