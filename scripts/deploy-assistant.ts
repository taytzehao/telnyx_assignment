/**
 * Deploy the ACME Clinic AI Assistant with the conversation workflow.
 *
 * Reads TELNYX_API_KEY from process env, loads the conversation_flow JSON,
 * registers the MCP server (or reuses an existing one), creates or updates
 * the AI Assistant via the Telnyx API, and reports the assistant ID.
 *
 * Usage: npx tsx scripts/deploy-assistant.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");
const FLOW_PATH = join(ROOT, "assistant", "conversation-flow.json");

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
if (!TELNYX_API_KEY) {
  console.error("ERROR: TELNYX_API_KEY environment variable is required.");
  process.exit(1);
}

const ASSISTANT_ID = process.env.ASSISTANT_ID ?? "";
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL ?? "";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? "";
const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME ?? "acme-clinic-mcp";

const TELNYX_API_BASE = "https://api.telnyx.com/v2";

async function findMcpServerByName(name: string): Promise<string | null> {
  const res = await fetch(`${TELNYX_API_BASE}/ai/mcp_servers`, {
    headers: { "Authorization": `Bearer ${TELNYX_API_KEY}` },
  });
  if (!res.ok) return null;
  const data = await res.json() as { data?: { id: string; name: string }[] };
  const found = data.data?.find((s) => s.name === name);
  return found?.id ?? null;
}

async function ensureMcpServer(name: string, url: string): Promise<string> {
  const existing = await findMcpServerByName(name);
  if (existing) {
    console.log(`MCP server '${name}' already exists: ${existing}`);
    return existing;
  }
  const res = await fetch(`${TELNYX_API_BASE}/ai/mcp_servers`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, url, transport: "streamable_http" }),
  });
  if (!res.ok) {
    console.error(`Failed to create MCP server (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json() as { id: string };
  console.log(`MCP server '${name}' created: ${data.id}`);
  return data.id;
}

async function main() {
  const flow = JSON.parse(readFileSync(FLOW_PATH, "utf-8"));
  console.log("Loaded conversation_flow:", flow.conversation_flow.nodes.length, "nodes,", flow.conversation_flow.edges.length, "edges");

  const webhookUrl = EDGE_FUNCTION_URL
    ? `${EDGE_FUNCTION_URL.replace(/\/$/, "")}/webhook`
    : "";
  const mcpUrl = MCP_SERVER_URL || (EDGE_FUNCTION_URL ? `${EDGE_FUNCTION_URL.replace(/\/$/, "")}/mcp` : "");

  if (!webhookUrl) {
    console.warn("WARNING: EDGE_FUNCTION_URL not set. The dynamic_variables_webhook_url will not be configured.");
  }

  let mcpServerId = "";
  if (mcpUrl) {
    mcpServerId = await ensureMcpServer(MCP_SERVER_NAME, mcpUrl);
  }

  const assistantName = "ACME Clinic Assistant";
  const assistantConfig: Record<string, unknown> = {
    name: assistantName,
    instructions:
      "You are the ACME Clinic automated assistant. You help callers with FAQs about hours, location, services, and fees, and manage appointments (create, list, cancel) for the current caller. Appointments are 30-minute slots between 9 AM and 5 PM. If you cannot help with a request, inform the caller to call the human line. Be courteous and concise.",
    dynamic_variables_webhook_url: webhookUrl || undefined,
    conversation_flow: flow.conversation_flow,
  };

  if (mcpServerId) {
    assistantConfig.mcp_servers = [{ id: mcpServerId }];
  }

  if (ASSISTANT_ID) {
    console.log(`Updating assistant ${ASSISTANT_ID}...`);
    const res = await fetch(`${TELNYX_API_BASE}/ai/assistants/${ASSISTANT_ID}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(assistantConfig),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Failed to update assistant (${res.status}): ${errText}`);
      process.exit(1);
    }
    const data = await res.json() as { id?: string; data?: { id: string } };
    const assistantId = data.id ?? data.data?.id;
    console.log("Assistant updated:", assistantId);
  } else {
    console.log("Creating new assistant...");
    const res = await fetch(`${TELNYX_API_BASE}/ai/assistants`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(assistantConfig),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Failed to create assistant (${res.status}): ${errText}`);
      process.exit(1);
    }
    const data = await res.json() as { id?: string; data?: { id: string } };
    const assistantId = data.id ?? data.data?.id;
    console.log("Assistant created:", assistantId);
    console.log("");
    console.log("To update this assistant later, set ASSISTANT_ID and re-run:");
    console.log(`  ASSISTANT_ID=${assistantId}`);
  }

  console.log("\nNext steps:");
  console.log("  1. Assign a phone number in the Telnyx Portal (AI Assistants → assistant → Phone Numbers)");
  console.log("  2. Call the phone number to test the workflow");
  console.log("  3. Review webhook logs in the Portal to verify dynamic variables");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
