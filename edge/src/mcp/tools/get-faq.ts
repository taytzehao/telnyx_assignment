import type { Env } from "../../env";
import { getFaq } from "../../lib/faq";
import { log, generateRequestId } from "../../lib/logger";

export interface GetFaqArgs {
  caller_number: string;
  category: string;
}

export interface GetFaqResult {
  found: boolean;
  category: string;
  content: string;
}

export async function handleGetFaq(
  args: GetFaqArgs,
  env: Env,
): Promise<{ status: number; body: GetFaqResult }> {
  const requestId = generateRequestId();
  const start = Date.now();
  const tool = "get_faq";
  const caller = args.caller_number ?? "unknown";

  try {
    const result = await getFaq(env.SESSIONS, args.category);

    log({
      requestId,
      caller,
      node: tool,
      outcome: "success",
      latencyMs: Date.now() - start,
      tool,
      category: args.category,
      found: result.found,
    });

    return { status: 200, body: result };
  } catch (error) {
    log({
      requestId,
      caller,
      node: tool,
      outcome: "error",
      latencyMs: Date.now() - start,
      tool,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      status: 500,
      body: {
        found: false,
        category: args.category,
        content: "",
      },
    };
  }
}
