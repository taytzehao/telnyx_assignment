import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type {
  TestScenario,
  TestCache,
  TestRunResult,
  TestRunStatus,
} from "./types";
import type { EvalClient } from "./client";
import { testCallerId, type CallerStatePreparer } from "./caller-state";

const TERMINAL_STATUSES: TestRunStatus[] = [
  "passed",
  "failed",
  "error",
];

export interface EvalRunnerOptions {
  cachePath?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** Resets (and seeds) the test caller's appointments before each run. */
  callerState?: CallerStatePreparer;
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
  private callerState?: CallerStatePreparer;

  constructor(client: EvalClient, options?: EvalRunnerOptions) {
    this.client = client;
    this.cachePath = options?.cachePath ?? ".telnyx/eval-tests.json";
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;
    this.timeoutMs = options?.timeoutMs ?? 120000;
    this.callerState = options?.callerState;
  }

  async run(scenario: TestScenario): Promise<RunOutcome> {
    if (scenario.seed_appointments?.length && !this.callerState) {
      throw new Error(
        `"${scenario.name}" needs seed_appointments, but the runner has no callerState to create them.`,
      );
    }
    const cache = this.readCache();

    let testId: string | undefined = cache[scenario.name];
    if (testId) {
      try {
        // The cache only maps names to IDs; push the current scenario so
        // edited instructions/rubrics are what actually runs.
        await this.client.updateTest(testId, scenario);
      } catch (err) {
        if (!this.isNotFoundError(err)) throw err;
        testId = undefined;
      }
    }
    if (!testId) {
      testId = await this.recreateTest(scenario, cache);
    }

    let runResponse: TestRunResult;
    try {
      await this.prepareCaller(testId, scenario);
      runResponse = await this.client.triggerRun(testId);
    } catch (err) {
      if (!this.isNotFoundError(err)) throw err;
      testId = await this.recreateTest(scenario, cache);
      await this.prepareCaller(testId, scenario);
      runResponse = await this.client.triggerRun(testId);
    }

    const result = await this.pollRun(testId, runResponse.run_id);
    return { testRun: result, scenarioName: scenario.name };
  }

  /** Each test is its own caller, so start every run from a known appointment state. */
  private async prepareCaller(testId: string, scenario: TestScenario): Promise<void> {
    await this.callerState?.prepare(testCallerId(testId), scenario.seed_appointments ?? []);
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
