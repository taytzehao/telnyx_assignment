import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadConfig, validateConfig, withWebhookUrl } from "../workflow/builder";
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

  let webhookUrl: string;
  if (flagUrl) {
    webhookUrl = withWebhookPath(flagUrl);
    console.log(`\u2713 Using webhook URL from --webhook-url: ${webhookUrl}`);
  } else if (process.env.ASSISTANT_CACHE) {
    webhookUrl = withWebhookPath(process.env.ASSISTANT_CACHE);
    console.log(`\u2713 Using edge URL from ASSISTANT_CACHE: ${webhookUrl}`);
  } else {
    console.error(
      "\u2717 No webhook URL found.\n  Provide --webhook-url or set ASSISTANT_CACHE in .env.",
    );
    process.exit(1);
  }

  const configWithWebhook = withWebhookUrl(config, webhookUrl);
  const client = new TelnyxAssistantClient();

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
}

main().catch((err: unknown) => {
  console.error(
    "\u2717 Deploy failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
