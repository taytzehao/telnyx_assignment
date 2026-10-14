import type { Env } from "../../env";
import { getFaq } from "../../lib/faq";
import { log, errorMessage } from "../../lib/logger";
import { setContext } from "../../lib/context";

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
  const caller = args.caller_number ?? "unknown";
  setContext({ tool: "get_faq", caller });

  try {
    const result = await getFaq(env.SESSIONS, args.category);

    setContext({ outcome: "success" });
    log.info("tool.completed", {
      category: args.category,
      found: result.found,
    });

    return { status: 200, body: result };
  } catch (error) {
    setContext({ outcome: "error" });
    log.error("tool.failed", { error: errorMessage(error) });

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
