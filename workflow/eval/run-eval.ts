import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { handleRequestScenario } from "./scenarios";
import { allClinicScenarios } from "./clinic-scenarios";
import type { TestScenario } from "./types";
import { EvalClient } from "./client";
import { EvalRunner } from "./runner";

interface CliArgs {
  suite?: string;
  scenario?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite" && i + 1 < argv.length) {
      args.suite = argv[i + 1];
      i++;
    } else if (argv[i] === "--scenario" && i + 1 < argv.length) {
      args.scenario = argv[i + 1];
      i++;
    }
  }
  return args;
}

function getDestination(): string {
  if (process.env.ASSISTANT_DESTINATION) {
    return process.env.ASSISTANT_DESTINATION;
  }

  const assistantCachePath = resolve(".telnyx/assistant.json");
  if (existsSync(assistantCachePath)) {
    try {
      const raw = readFileSync(assistantCachePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data.assistant_id) {
        return String(data.assistant_id);
      }
    } catch {
      // fall through
    }
  }

  if (process.env.ASSISTANT_ID) {
    return process.env.ASSISTANT_ID;
  }

  return "";
}

function selectScenarios(args: CliArgs, destination: string): TestScenario[] {
  const boilerplate: TestScenario = { ...handleRequestScenario, destination };
  const clinicWithDest: TestScenario[] = allClinicScenarios.map((s) => ({
    ...s,
    destination,
  }));

  const allScenarios = [boilerplate, ...clinicWithDest];

  if (args.scenario) {
    const matched = allScenarios.filter((s) => s.name === args.scenario);
    if (matched.length === 0) {
      console.error(
        `\u2717 No scenario found with name: "${args.scenario}"`,
      );
      console.error(
        `  Available scenarios: ${allScenarios.map((s) => s.name).join(", ")}`,
      );
      process.exit(1);
    }
    return matched;
  }

  if (args.suite) {
    const matched = allScenarios.filter((s) => s.test_suite === args.suite);
    if (matched.length === 0) {
      console.error(`\u2717 No scenarios found in suite: "${args.suite}"`);
      console.error(
        `  Available suites: ${[...new Set(allScenarios.map((s) => s.test_suite))].join(", ")}`,
      );
      process.exit(1);
    }
    return matched;
  }

  return allScenarios;
}

interface ScenarioResult {
  scenarioName: string;
  testRun: import("./types").TestRunResult;
  error?: string;
}

async function main(): Promise<void> {
  console.log("=== Workflow Eval ===\n");

  const args = parseArgs(process.argv.slice(2));
  const destination = getDestination();
  if (!destination) {
    console.error(
      "\u2717 No destination configured.\n  Set ASSISTANT_DESTINATION (or ASSISTANT_ID) in .env, or deploy an assistant first.",
    );
    process.exit(1);
  }

  const selectedScenarios = selectScenarios(args, destination);

  console.log(
    `Selected ${selectedScenarios.length} scenario(s)${args.suite ? ` from suite "${args.suite}"` : ""}${args.scenario ? ` matching "${args.scenario}"` : ""}:`,
  );
  for (const s of selectedScenarios) {
    console.log(`  \u25B6 ${s.name} [${s.test_suite}] (${s.telnyx_conversation_channel})`);
  }
  console.log(`  Destination: ${destination}\n`);

  const client = new EvalClient();
  const runner = new EvalRunner(client);

  const results: ScenarioResult[] = [];

  for (const scenario of selectedScenarios) {
    console.log(`\n--- Running: ${scenario.name} ---`);
    try {
      const { testRun } = await runner.run(scenario);
      console.log(`  Run ID: ${testRun.run_id}`);
      console.log(`  Status: ${testRun.status}`);
      results.push({ scenarioName: scenario.name, testRun });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`  \u2717 Error: ${errorMsg}`);
      results.push({
        scenarioName: scenario.name,
        testRun: {
          run_id: "",
          test_id: "",
          status: "error",
          triggered_by: "",
          created_at: "",
        },
        error: errorMsg,
      });
    }
  }

  console.log("\n=== Summary Matrix ===\n");

  let totalCriteria = 0;
  let passedCriteria = 0;
  let failedScenarios = 0;

  for (const result of results) {
    console.log(`${result.scenarioName}:`);
    if (result.error) {
      console.log(`  \u2717 ERROR: ${result.error}`);
      failedScenarios++;
      continue;
    }

    const testRun = result.testRun;
    if (testRun.status === "error") {
      console.log(`  \u2717 Run errored (status: error)`);
      failedScenarios++;
      continue;
    }

    if (!testRun.detail_status || testRun.detail_status.length === 0) {
      console.log(`  \u26A0 No rubric criteria reported`);
      continue;
    }

    let scenarioAllPassed = true;
    for (const detail of testRun.detail_status) {
      const icon =
        detail.status === "passed"
          ? "\u2713"
          : detail.status === "failed"
            ? "\u2717"
            : "\u26A0";
      console.log(`  ${icon} ${detail.name}: ${detail.status}`);
      totalCriteria++;
      if (detail.status === "passed") {
        passedCriteria++;
      } else {
        scenarioAllPassed = false;
      }
    }

    if (!scenarioAllPassed) {
      failedScenarios++;
    }
  }

  console.log(
    `\nTotal: ${passedCriteria}/${totalCriteria} criteria passed, ${failedScenarios} scenario(s) with failures.`,
  );

  if (failedScenarios > 0 || passedCriteria < totalCriteria) {
    console.log("\n\u2717 One or more criteria did not pass.");
    process.exit(1);
  }

  console.log("\n\u2705 All criteria passed.");
}

main();
