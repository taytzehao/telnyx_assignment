import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadConfig, validateConfig, withWebhookUrl, withMcpServer, withSharedToolIds } from "../workflow/builder";
import { TelnyxAssistantClient } from "../workflow/client";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(here, "..");
const CONFIG_PATH = join(ROOT_DIR, "workflow", "assistant.config.json");

function parseArgs(argv: string[]): { webhookUrl: string | null } {
  let webhookUrl: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--webhook-url" && i + 1 < argv.length) {
      webhookUrl = argv[i + 1];
    }
  }
  return { webhookUrl };
}

function withWebhookPath(baseUrl: string): string {
  const url = baseUrl.replace(/\/$/, "");
  return url.endsWith("/webhook") ? url : `${url}/webhook`;
}

function withMcpPath(baseUrl: string): string {
  const url = baseUrl.replace(/\/$/, "");
  return url.endsWith("/mcp") ? url : `${url}/mcp`;
}

function withToolPath(baseUrl: string, tool: string): string {
  const url = baseUrl.replace(/\/$/, "");
  return `${url}/tools/${tool}`;
}

async function main(): Promise<void> {
  const { webhookUrl: flagUrl } = parseArgs(process.argv.slice(2));

  console.log("=== Assistant Deploy ===\n");

  const config = loadConfig(CONFIG_PATH);
  const result = validateConfig(config);
  if (!result.ok) {
    console.error("\u2717 Config validation failed:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log("\u2713 Config validated");

  let edgeBaseUrl: string;
  if (flagUrl) {
    edgeBaseUrl = flagUrl.replace(/\/webhook\/?$/, "");
    console.log(`\u2713 Using edge URL from --webhook-url: ${edgeBaseUrl}`);
  } else if (process.env.ASSISTANT_CACHE) {
    edgeBaseUrl = process.env.ASSISTANT_CACHE.replace(/\/$/, "");
    console.log(`\u2713 Using edge URL from ASSISTANT_CACHE: ${edgeBaseUrl}`);
  } else {
    console.error(
      "\u2717 No edge URL found.\n  Provide --webhook-url or set ASSISTANT_CACHE in .env.",
    );
    process.exit(1);
  }

  const webhookUrl = withWebhookPath(edgeBaseUrl);
  const mcpUrl = withMcpPath(edgeBaseUrl);
  const client = new TelnyxAssistantClient();

  console.log("\u2192 Registering MCP server...");
  const mcpServerId = await client.ensureMcpServer("acme-clinic-mcp", mcpUrl);
  console.log(`\u2713 MCP server: ${mcpServerId}`);

  console.log("\u2192 Creating shared webhook tools...");
  const createToolId = await client.ensureSharedTool(
    "acme-create-appointment",
    "webhook",
    {
      name: "create_appointment",
      description: "Create a 30-minute appointment for the caller. Slots must be 9AM-5PM.",
      url: withToolPath(edgeBaseUrl, "create-appointment"),
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {
          caller_number: { type: "string", description: "The caller's phone number" },
          date: { type: "string", description: "Appointment date YYYY-MM-DD" },
          start_time: { type: "string", description: "Start time HH:MM" },
        },
        required: ["caller_number", "date", "start_time"],
      },
      headers: [],
      path_parameters: { type: "object", properties: {} },
      query_parameters: { type: "object", properties: {} },
    },
  );
  console.log(`\u2713 create_appointment tool: ${createToolId}`);

  const listToolId = await client.ensureSharedTool(
    "acme-list-appointments",
    "webhook",
    {
      name: "list_appointments",
      description: "List all appointments for the caller.",
      url: withToolPath(edgeBaseUrl, "list-appointments"),
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {
          caller_number: { type: "string", description: "The caller's phone number" },
        },
        required: ["caller_number"],
      },
      headers: [],
      path_parameters: { type: "object", properties: {} },
      query_parameters: { type: "object", properties: {} },
    },
  );
  console.log(`\u2713 list_appointments tool: ${listToolId}`);

  const cancelToolId = await client.ensureSharedTool(
    "acme-cancel-appointments",
    "webhook",
    {
      name: "cancel_appointments",
      description: "Cancel an appointment by time or ID.",
      url: withToolPath(edgeBaseUrl, "cancel-appointments"),
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {
          caller_number: { type: "string", description: "The caller's phone number" },
          cancel_by: { type: "string", enum: ["time", "id"], description: "Cancel by time or ID" },
          date: { type: "string", description: "Date (when cancel_by=time)" },
          start_time: { type: "string", description: "Start time (when cancel_by=time)" },
          appointment_id: { type: "string", description: "Appointment ID (when cancel_by=id)" },
        },
        required: ["caller_number", "cancel_by"],
      },
      headers: [],
      path_parameters: { type: "object", properties: {} },
      query_parameters: { type: "object", properties: {} },
    },
  );
  console.log(`\u2713 cancel_appointments tool: ${cancelToolId}`);

  console.log("\u2192 Creating shared update_dynamic_variables tool...");
  const captureToolId = await client.ensureSharedTool(
    "capture_appointment_details",
    "update_dynamic_variables",
    {
      description:
        "Capture appointment date and time from the conversation so the booking tool can use them.",
      name: "capture_appointment_details",
      updatable_variables: [
        { name: "appointment_date", description: "The date to book in YYYY-MM-DD format", type: "string" },
        { name: "appointment_start_time", description: "The start time to book in HH:MM 24-hour format", type: "string" },
        { name: "cancel_date", description: "The date of the appointment to cancel in YYYY-MM-DD format", type: "string" },
        { name: "cancel_start_time", description: "The start time of the appointment to cancel in HH:MM format", type: "string" },
        { name: "cancel_appointment_id", description: "The ID of the appointment to cancel", type: "string" },
      ],
    },
  );
  console.log(`\u2713 capture_appointment_details tool: ${captureToolId}`);

  let configWithWebhook = withWebhookUrl(config, webhookUrl);
  configWithWebhook = withMcpServer(configWithWebhook, mcpServerId);
  configWithWebhook = withSharedToolIds(configWithWebhook, [
    captureToolId,
    createToolId,
    listToolId,
    cancelToolId,
  ]);

  const toolMap: Record<string, string> = {
    PLACEHOLDER_CREATE_TOOL_ID: createToolId,
    PLACEHOLDER_LIST_TOOL_ID: listToolId,
    PLACEHOLDER_CANCEL_TOOL_ID: cancelToolId,
    PLACEHOLDER_CAPTURE_TOOL_ID: captureToolId,
  };

  const flow = configWithWebhook.conversation_flow;
  if (flow) {
    for (const node of flow.nodes) {
      if ("shared_tool_ids" in node && node.shared_tool_ids) {
        node.shared_tool_ids = node.shared_tool_ids.map(
          (id: string) => toolMap[id] ?? id,
        );
      }
    }
  }

  let assistantId: string;
  if (process.env.ASSISTANT_ID) {
    assistantId = process.env.ASSISTANT_ID;
    console.log(`\u2192 Updating existing assistant: ${assistantId}\u2026`);
    const updated = await client.update(assistantId, configWithWebhook);
    assistantId = updated.id;
    console.log(`\u2713 Assistant updated: ${assistantId}`);
  } else {
    console.log("\u2192 Creating new assistant\u2026");
    const created = await client.create(configWithWebhook);
    assistantId = created.id;
    console.log(`\u2713 Assistant created: ${assistantId}`);
    console.log(
      `  Set ASSISTANT_ID=${assistantId} in .env for idempotent redeploys.`,
    );
  }

  console.log(`\n\u2705 Assistant ID: ${assistantId}`);
  console.log(`   Webhook URL: ${webhookUrl}`);
  console.log(`   MCP server:  ${mcpUrl} (${mcpServerId})`);
  console.log(`   Shared tools:`);
  console.log(`     capture_appointment_details: ${captureToolId}`);
  console.log(`     create_appointment:          ${createToolId}`);
  console.log(`     list_appointments:           ${listToolId}`);
  console.log(`     cancel_appointments:         ${cancelToolId}`);
}

main().catch((err: unknown) => {
  console.error(
    "\u2717 Deploy failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
