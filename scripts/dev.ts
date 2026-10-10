import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const EDGE_DIR = resolve(here, "..", "edge");

console.log(`\n\u25B6 Starting local dev for edge function`);
console.log(`  dir: ${EDGE_DIR}\n`);

const child = spawn("telnyx-edge", ["dev"], {
  cwd: EDGE_DIR,
  stdio: "inherit",
});

child.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "ENOENT") {
    console.error(
      "\u2717 telnyx-edge CLI not found. Install from https://github.com/team-telnyx/edge-compute/releases",
    );
  } else {
    console.error("\u2717 Failed to start telnyx-edge dev:", err.message);
  }
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
