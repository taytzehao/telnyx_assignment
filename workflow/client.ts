import { randomUUID } from "node:crypto";
import Telnyx from "telnyx";
import type { CreateAssistantRequest, AssistantUpdateParams, Assistant } from "./types";
import type { SharedToolResponse, ToolCreateParams, ToolUpdateParams } from "telnyx/resources/ai/tools";

export class TelnyxAssistantClient {
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

  async create(config: CreateAssistantRequest): Promise<Assistant> {
    return this.client.ai.assistants.create(config, {
      idempotencyKey: randomUUID(),
    }) as Promise<Assistant>;
  }

  async update(id: string, config: AssistantUpdateParams): Promise<Assistant> {
    return this.client.ai.assistants.update(id, config) as Promise<Assistant>;
  }

  async retrieve(id: string): Promise<Assistant> {
    return this.client.ai.assistants.retrieve(id) as Promise<Assistant>;
  }

  async ensureSharedTool(
    displayName: string,
    type: string,
    toolDefinition: Record<string, unknown>,
  ): Promise<string> {
    const params: ToolCreateParams = {
      display_name: displayName,
      type,
      [type]: toolDefinition,
    } as ToolCreateParams;
    const tools = await this.client.ai.tools.list();
    for await (const tool of tools) {
      if (tool.display_name === displayName) {
        // Push the current definition so redeploys pick up schema/header changes.
        await this.client.ai.tools.update(tool.id, params as ToolUpdateParams);
        return tool.id;
      }
    }
    const created = (await this.client.ai.tools.create(params)) as SharedToolResponse;
    return created.id;
  }
}
