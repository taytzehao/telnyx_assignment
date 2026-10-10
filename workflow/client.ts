import { randomUUID } from "node:crypto";
import Telnyx from "telnyx";
import type { CreateAssistantRequest, AssistantUpdateParams, Assistant } from "./types";
import type { SharedToolResponse, ToolCreateParams } from "telnyx/resources/ai/tools";

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

  async ensureMcpServer(name: string, url: string): Promise<string> {
    const res = await fetch("https://api.telnyx.com/v2/ai/mcp_servers", {
      headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: { id: string; name: string }[] };
      const existing = data.data?.find((s) => s.name === name);
      if (existing) return existing.id;
    }
    const createRes = await fetch("https://api.telnyx.com/v2/ai/mcp_servers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, url, transport: "streamable_http" }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create MCP server: ${await createRes.text()}`);
    }
    const created = (await createRes.json()) as { id: string };
    return created.id;
  }

  async ensureSharedTool(
    displayName: string,
    type: string,
    toolDefinition: Record<string, unknown>,
  ): Promise<string> {
    const tools = await this.client.ai.tools.list();
    for await (const tool of tools) {
      if (tool.display_name === displayName) {
        return tool.id;
      }
    }
    const params: ToolCreateParams = {
      display_name: displayName,
      type,
      ...Object.fromEntries(
        Object.entries({ [type]: toolDefinition }).filter(([, v]) => v !== undefined),
      ),
    } as ToolCreateParams;
    const created = (await this.client.ai.tools.create(params)) as SharedToolResponse;
    return created.id;
  }
}
