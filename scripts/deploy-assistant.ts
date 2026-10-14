import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadConfig, validateConfig, resolvePrompts, withWebhookUrl, withSharedToolIds } from "../workflow/builder";
import { TelnyxAssistantClient } from "../workflow/client";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(here, "..");
const CONFIG_PATH = join(ROOT_DIR, "workflow", "assistant.config.json");

/**
 * Every webhook tool sends the caller's identity in this header. Telnyx
 * interpolates `{{telnyx_end_user_target}}` (the end user's phone number)
 * into tool header values, so the caller never has to be an LLM-supplied
 * body parameter. Must match `END_USER_TARGET_HEADER` in
 * `edge/src/tools/handler.ts`.
 */
const END_USER_TARGET_HEADERS = [
  { name: "X-End-User-Target", value: "{{telnyx_end_user_target}}" },
];

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

  const resolvedConfig = resolvePrompts(config);
  console.log("\u2713 Prompts resolved");

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
  const client = new TelnyxAssistantClient();

  console.log("\u2192 Creating shared webhook tools...");
  const faqToolId = await client.ensureSharedTool(
    "acme-get-faq",
    "webhook",
    {
      name: "get_faq",
      description: "Retrieve ACME Clinic FAQ content for one category: hours, location, services, or fees.",
      url: withToolPath(edgeBaseUrl, "get-faq"),
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["hours", "location", "services", "fees"],
            description: "FAQ category",
          },
        },
        required: ["category"],
      },
      headers: END_USER_TARGET_HEADERS,
      path_parameters: { type: "object", properties: {} },
      query_parameters: { type: "object", properties: {} },
    },
  );
  console.log(`\u2713 get_faq tool: ${faqToolId}`);

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
          date: { type: "string", description: "Appointment date YYYY-MM-DD" },
          start_time: { type: "string", description: "Start time HH:MM" },
        },
        required: ["date", "start_time"],
      },
      headers: END_USER_TARGET_HEADERS,
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
        properties: {},
      },
      headers: END_USER_TARGET_HEADERS,
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
          cancel_by: { type: "string", enum: ["time", "id"], description: "Cancel by time or ID" },
          date: { type: "string", description: "Date (when cancel_by=time)" },
          start_time: { type: "string", description: "Start time (when cancel_by=time)" },
          appointment_id: { type: "string", description: "Appointment ID (when cancel_by=id)" },
        },
        required: ["cancel_by"],
      },
      headers: END_USER_TARGET_HEADERS,
      path_parameters: { type: "object", properties: {} },
      query_parameters: { type: "object", properties: {} },
    },
  );
  console.log(`\u2713 cancel_appointments tool: ${cancelToolId}`);


  let configWithWebhook = withWebhookUrl(resolvedConfig, webhookUrl);
  configWithWebhook = withSharedToolIds(configWithWebhook, [
    faqToolId,
    createToolId,
    listToolId,
    cancelToolId,
  ]);

  const toolMap: Record<string, string> = {
    PLACEHOLDER_FAQ_TOOL_ID: faqToolId,
    PLACEHOLDER_CREATE_TOOL_ID: createToolId,
    PLACEHOLDER_LIST_TOOL_ID: listToolId,
    PLACEHOLDER_CANCEL_TOOL_ID: cancelToolId,
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
    try {
      const updated = await client.update(assistantId, configWithWebhook);
      assistantId = updated.id;
      console.log(`\u2713 Assistant updated: ${assistantId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
        console.log(`\u26A0 Assistant ${assistantId} no longer exists \u2014 creating a new one\u2026`);
        const created = await client.create(configWithWebhook);
        assistantId = created.id;
        console.log(`\u2713 Assistant created: ${assistantId}`);
        console.log(
          `  Update ASSISTANT_ID=${assistantId} in .env for idempotent redeploys.`,
        );
      } else {
        throw err;
      }
    }
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
  console.log(`   Shared tools:`);
  console.log(`     get_faq:                     ${faqToolId}`);
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
