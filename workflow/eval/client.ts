import { randomUUID } from "node:crypto";
import Telnyx from "telnyx";
import type {
  TestCreateParams,
  TestUpdateParams,
  AssistantTest,
  TestRunResponse,
  RunTriggerParams,
  RunRetrieveParams,
} from "telnyx/resources/ai/assistants/tests";
import type { TestScenario } from "./types";

export class EvalClient {
  private client: Telnyx;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.TELNYX_API_KEY ?? "";
    if (!key) {
      throw new Error(
        "TELNYX_API_KEY not set. Export it in your environment or pass it to the constructor.",
      );
    }
    this.client = new Telnyx({ apiKey: key });
  }

  async createTest(scenario: TestScenario): Promise<AssistantTest> {
    return this.client.ai.assistants.tests.create(toTestParams(scenario), {
      idempotencyKey: randomUUID(),
    }) as Promise<AssistantTest>;
  }

  /** Overwrite a cached test's definition so scenario edits take effect. */
  async updateTest(testId: string, scenario: TestScenario): Promise<AssistantTest> {
    const params: TestUpdateParams = toTestParams(scenario);
    return this.client.ai.assistants.tests.update(testId, params) as Promise<AssistantTest>;
  }

  async triggerRun(
    testId: string,
    params?: RunTriggerParams,
  ): Promise<TestRunResponse> {
    return this.client.ai.assistants.tests.runs.trigger(
      testId,
      params,
    ) as Promise<TestRunResponse>;
  }

  async getRun(
    testId: string,
    runId: string,
  ): Promise<TestRunResponse> {
    const params: RunRetrieveParams = { test_id: testId };
    return this.client.ai.assistants.tests.runs.retrieve(
      runId,
      params,
    ) as Promise<TestRunResponse>;
  }
}

function toTestParams(scenario: TestScenario): TestCreateParams {
  return {
    name: scenario.name,
    instructions: scenario.instructions,
    rubric: scenario.rubric,
    destination: scenario.destination,
    telnyx_conversation_channel: scenario.telnyx_conversation_channel,
    test_suite: scenario.test_suite,
    ...(scenario.max_duration_seconds !== undefined && {
      max_duration_seconds: scenario.max_duration_seconds,
    }),
  };
}
