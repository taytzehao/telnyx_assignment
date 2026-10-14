import type { TestScenario } from "./types";

export const handleRequestScenario: TestScenario = {
  name: "Routing: Handle Request",
  instructions:
    "You are a caller who needs help with a billing question. Ask clearly and stay on topic. Do not request escalation.",
  rubric: [
    {
      name: "Route to Handle",
      criteria:
        "The conversation reaches the Handle Request node rather than the Escalate node",
    },
    {
      name: "No Premature Escalation",
      criteria:
        "The assistant does not escalate to a human without justification",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: "workflow-routing",
  destination: "",
};
