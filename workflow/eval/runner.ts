import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type {
  TestScenario,
  TestCache,
  TestRunResult,
  TestRunStatus,
} from "./types";
import type { EvalClient } from "./client";

const TERMINAL_STATUSES: TestRunStatus[] = [
  "passed",
  "failed",
  "error",
];

export interface EvalRunnerOptions {
  cachePath?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface RunOutcome {
  testRun: TestRunResult;
  scenarioName: string;
}

export class EvalRunner {
  private client: EvalClient;
  private cachePath: string;
  private pollIntervalMs: number;
  private timeoutMs: number;

  constructor(client: EvalClient, options?: EvalRunnerOptions) {
    this.client = client;
    this.cachePath = options?.cachePath ?? ".telnyx/eval-tests.json";
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;
    this.timeoutMs = options?.timeoutMs ?? 120000;
  }

  async run(scenario: TestScenario): Promise<RunOutcome> {
    const cache = this.readCache();

    let testId = cache[scenario.name];
    let runResponse: TestRunResult;

    if (testId) {
      try {
        runResponse = await this.client.triggerRun(testId);
      } catch (err) {
        if (this.isNotFoundError(err)) {
          testId = await this.recreateTest(scenario, cache);
          runResponse = await this.client.triggerRun(testId);
        } else {
          throw err;
        }
      }
    } else {
      testId = await this.recreateTest(scenario, cache);
      runResponse = await this.client.triggerRun(testId);
    }

    const result = await this.pollRun(testId, runResponse.run_id);
    return { testRun: result, scenarioName: scenario.name };
  }

  private async recreateTest(
    scenario: TestScenario,
    cache: TestCache,
  ): Promise<string> {
    const test = await this.client.createTest(scenario);
    cache[scenario.name] = test.test_id;
    this.writeCache(cache);
    return test.test_id;
  }

  private async pollRun(
    testId: string,
    runId: string,
  ): Promise<TestRunResult> {
    const deadline = Date.now() + this.timeoutMs;
    let lastRun: TestRunResult;

    do {
      lastRun = await this.client.getRun(testId, runId);
      if (TERMINAL_STATUSES.includes(lastRun.status)) {
        return lastRun;
      }
      if (Date.now() >= deadline) {
        return lastRun;
      }
      await this.sleep(this.pollIntervalMs);
    } while (Date.now() < deadline);

    return lastRun;
  }

  private readCache(): TestCache {
    const fullPath = resolve(this.cachePath);
    if (!existsSync(fullPath)) return {};
    try {
      const raw = readFileSync(fullPath, "utf-8");
      return JSON.parse(raw) as TestCache;
    } catch {
      return {};
    }
  }

  private writeCache(cache: TestCache): void {
    const fullPath = resolve(this.cachePath);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, JSON.stringify(cache, null, 2), "utf-8");
  }

  private isNotFoundError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes("404") || msg.includes("not found");
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
