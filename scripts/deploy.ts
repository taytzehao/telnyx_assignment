import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, validateConfig, withWebhookUrl } from "../workflow/builder";
import { TelnyxAssistantClient } from "../workflow/client";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(here, "..");
const EDGE_DIR = join(ROOT_DIR, "edge");
const TOML_PATH = join(EDGE_DIR, "telnyx.toml");
const CONFIG_PATH = join(ROOT_DIR, "workflow", "assistant.config.json");

// ── Helpers ──────────────────────────────────────────────

function checkCli(): void {
  try {
    execSync("telnyx-edge --version", { stdio: "pipe" });
    console.log("\u2713 telnyx-edge CLI found");
  } catch {
    console.error(
      "\u2717 telnyx-edge CLI not found. Install from https://github.com/team-telnyx/edge-compute/releases",
    );
    process.exit(1);
  }
}

function checkAuth(): void {
  try {
    execSync("telnyx-edge auth status", { stdio: "pipe" });
    console.log("\u2713 Auth verified");
  } catch {
    console.error(
      '\u2717 Not authenticated. Run: telnyx-edge auth login  OR  telnyx-edge auth api-key set <KEY>',
    );
    process.exit(1);
  }
}

function readToml(path: string): string {
  return readFileSync(path, "utf-8");
}

function getTomlField(toml: string, key: string): string {
  const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml);
  return m?.[1] ?? "";
}

function setTomlField(toml: string, key: string, value: string): string {
  const re = new RegExp(`^${key}\\s*=\\s*"[^"]*"`, "m");
  if (re.test(toml)) {
    return toml.replace(re, `${key} = "${value}"`);
  }
  return toml;
}

/** One-time: register the function with Telnyx and write the func_id. */
function bootstrapFuncId(): void {
  let toml = readToml(TOML_PATH);
  const existing = getTomlField(toml, "func_id");
  if (existing) {
    console.log(`\u2713 func_id already present: ${existing}`);
    return;
  }

  const funcName = getTomlField(toml, "func_name") || "telnyx-webhook";
  console.log(`\u2192 Bootstrapping func_id via telnyx-edge new-func (name=${funcName})\u2026`);

  const tmpDir = mkdtempSync(join(tmpdir(), "edge-bootstrap-"));
  try {
    execSync(
      `telnyx-edge new-func --actor --name=${funcName} -l ts`,
      { cwd: tmpDir, stdio: "pipe" },
    );
    const scaffoldToml = readToml(join(tmpDir, funcName, "telnyx.toml"));
    const funcId = getTomlField(scaffoldToml, "func_id");

    if (!funcId) {
      console.error("\u2717 Could not extract func_id from scaffolded project");
      process.exit(1);
    }

    toml = setTomlField(toml, "func_id", funcId);
    writeFileSync(TOML_PATH, toml);
    console.log(`\u2713 func_id bootstrapped: ${funcId}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function checkPlaceholders(): void {
  const toml = readToml(TOML_PATH);
  const placeholders = toml.match(/REPLACE_WITH_\w+/g);
  if (placeholders) {
    console.warn(
      `\u26A0 Placeholders in telnyx.toml: ${placeholders.join(", ")} \u2014 update before relying on this deploy.`,
    );
  }
}

function runStep(label: string, cmd: string): void {
  console.log(`\n\u25B6 ${label}`);
  try {
    execSync(cmd, { cwd: EDGE_DIR, stdio: "inherit" });
    console.log(`\u2713 ${label} passed`);
  } catch {
    console.error(`\u2717 ${label} failed`);
    process.exit(1);
  }
}

function ship(): void {
  console.log("\n\u25B6 Shipping to Telnyx Edge \u2026");
  try {
    execSync("telnyx-edge ship", {
      cwd: EDGE_DIR,
      stdio: "inherit",
      timeout: 600000,
    });
  } catch {
    console.error("\u2717 telnyx-edge ship failed");
    process.exit(1);
  }
}

function getDeployedUrl(): string | null {
  try {
    const output = execSync("telnyx-edge inspect", {
      cwd: EDGE_DIR,
      encoding: "utf-8",
      stdio: "pipe",
    });
    const match = output.match(/https:\/\/[^\s"'`]+telnyxcompute\.com/);
    return match?.[0] ?? null;
  } catch {
    return null;
  }
}

function pollHealth(url: string): void {
  const healthUrl = url.replace(/\/$/, "") + "/health/liveness";
  console.log(`\n\u25B6 Polling ${healthUrl} \u2026`);

  for (let i = 1; i <= 30; i++) {
    try {
      const status = execSync(
        `curl -sS -o /dev/null -w '%{http_code}' --max-time 3 '${healthUrl}'`,
        { encoding: "utf-8" },
      ).trim();
      if (status === "200") {
        console.log(`\n\u2713 Health check passed (attempt ${i})`);
        return;
      }
    } catch {
      // Function not up yet.
    }
    process.stdout.write(".");
    execSync("sleep 5", { stdio: "ignore" });
  }
  console.warn(
    "\n\u26A0 Health check timed out \u2014 the function may still be starting. Check: telnyx-edge logs --from-dir " +
      EDGE_DIR,
  );
}

// ── Assistant Deploy ────────────────────────────────────

async function deployAssistant(edgeUrl: string): Promise<void> {
  console.log("\n=== Assistant Deploy ===\n");

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

  const webhookUrl = edgeUrl.replace(/\/$/, "") + "/webhook";
  const configWithWebhook = withWebhookUrl(config, webhookUrl);
  console.log(`\u2713 Webhook URL: ${webhookUrl}`);

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
  console.log(
    "  Assign a phone number to this assistant in the Telnyx Portal to test.",
  );
}

// ── Main ──────────────────────────────────────────────────

console.log("=== Telnyx Edge Deploy ===\n");

checkCli();
checkAuth();
bootstrapFuncId();
checkPlaceholders();

runStep("Installing dependencies", "npm install");
runStep("Generating binding types", "telnyx-edge types");
runStep("Typechecking", "npm run typecheck");
runStep("Linting", "npm run lint");
runStep("Running tests", "npm run test");

ship();

const url = getDeployedUrl();
if (url) {
  console.log(`\n\u2705 Live URL: ${url}`);
  pollHealth(url);
  await deployAssistant(url);
} else {
  console.warn(
    "\n\u26A0 Could not extract URL \u2014 check the ship output above for the deployed URL.",
  );
}

console.log("\n=== Deploy complete ===");
