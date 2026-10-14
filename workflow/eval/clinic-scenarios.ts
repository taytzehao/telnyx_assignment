import type { TestScenario } from "./types";

// Test suite identifiers
export const CLINIC_ROUTING_SUITE = "clinic-routing";
export const CLINIC_LIFECYCLE_SUITE = "clinic-appointment-lifecycle";
export const CLINIC_EDGE_CASES_SUITE = "clinic-edge-cases";

// High-value branching node IDs in the conversation flow
const HIGH_VALUE_BRANCHING_NODES = new Set([
  "n_intent",
  "n_appt_menu",
  "n_verify_create",
  "n_verify_cancel",
  "n_anything_else",
]);

export { HIGH_VALUE_BRANCHING_NODES };

// ============================================================================
// Suite: clinic-routing
// 16 scenarios — one per high-value LLM-conditioned routing edge
// ============================================================================

// --- n_intent edges (4) ---

export const intentToFaq: TestScenario = {
  name: "Routing: Intent\u2192FAQ",
  instructions:
    "You are a caller to ACME Clinic. In your first message, say: \"What are your clinic hours?\" If the assistant asks for your phone number or any personal information, say: \"I just want to know your hours, you should already know who I am.\" Keep repeating your question until it is answered. Do not ask about appointments, do not ask for a human, and do not say you have no questions.",
  rubric: [
    {
      name: "Reached FAQ node",
      criteria:
        "The conversation reaches the Answer FAQ node, indicating the assistant correctly classified this as a FAQ question",
    },
    {
      name: "Did not reach Escalate node",
      criteria:
        "The conversation does not reach the Escalate node, confirming the assistant did not misclassify this as an out-of-scope request",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_intent_to_faq"],
};

export const intentToAppt: TestScenario = {
  name: "Routing: Intent\u2192Appt",
  instructions:
    "You are a caller to ACME Clinic. In your first message, say: \"I'd like to book an appointment.\" If the assistant asks for your phone number or any personal information, say: \"You should already have my number. I just want to book an appointment.\" If the assistant asks for date and time, say: \"January 15th at 10 AM.\" Do not ask FAQ questions, do not ask for a human, and do not say you have no questions.",
  rubric: [
    {
      name: "Reached Appointment Menu node",
      criteria:
        "The conversation reaches the Appointment Menu node, indicating the assistant correctly classified this as an appointment management request",
    },
    {
      name: "Did not reach FAQ node",
      criteria:
        "The conversation does not reach the Answer FAQ node, confirming the assistant did not misclassify this as a FAQ question",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_intent_to_appt_menu"],
};

export const intentToEscalate: TestScenario = {
  name: "Routing: Intent\u2192Escalate",
  instructions:
    "You are a caller to ACME Clinic. In your first message, say: \"I need a prescription refilled.\" If the assistant asks for your phone number or personal information, say: \"You should already have my number. I just need a prescription refill.\" Keep repeating your request. Do not ask about hours, location, services, fees, or appointments.",
  rubric: [
    {
      name: "Reached Escalate node",
      criteria:
        "The conversation reaches the Escalate node, indicating the assistant correctly classified this as an out-of-scope request",
    },
    {
      name: "Did not reach FAQ node",
      criteria:
        "The conversation does not reach the Answer FAQ node, confirming the assistant did not attempt to handle this as a FAQ question",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_intent_to_escalate"],
};

export const intentToGoodbye: TestScenario = {
  name: "Routing: Intent\u2192Done",
  instructions:
    "You are a caller to ACME Clinic. After being greeted, immediately say: \"Actually, I don't need any help. I'm fine, thank you.\" If the assistant asks for your phone number, say: \"I said I don't need help, goodbye.\" Do not ask any questions about the clinic.",
  rubric: [
    {
      name: "Reached Goodbye node",
      criteria:
        "The conversation reaches the Goodbye node, indicating the assistant correctly identified the caller does not need help",
    },
    {
      name: "Did not reach FAQ node",
      criteria:
        "The conversation does not reach the Answer FAQ node, confirming the assistant did not misclassify this as a FAQ question",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_intent_to_goodbye"],
};

// --- n_appt_menu edges (4) ---

export const apptMenuToCreate: TestScenario = {
  name: "Routing: ApptMenu\u2192Create",
  instructions:
    "You are a caller to ACME Clinic. You have already told the assistant you want to manage appointments. When asked which action you want, immediately say: \"I want to book a new appointment.\" If the assistant asks for your phone number, say: \"You should already have my number. I just want to book a new appointment.\" If the assistant asks for date and time, say: \"January 15th at 10 AM.\" Do not ask to list or cancel appointments, and do not change your mind.",
  rubric: [
    {
      name: "Reached Collect Appt Details node",
      criteria:
        "The conversation reaches the Collect Appt Details node, indicating the assistant correctly routed to appointment creation",
    },
    {
      name: "Did not reach List Appointments",
      criteria:
        "The conversation does not reach the List Appointments node, confirming the assistant did not misroute to listing",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_appt_menu_to_collect"],
};

export const apptMenuToList: TestScenario = {
  name: "Routing: ApptMenu\u2192List",
  instructions:
    "You are a caller to ACME Clinic. You have already told the assistant you want to manage appointments. When asked which action you want, immediately say: \"I want to see my existing appointments.\" If the assistant asks for your phone number, say: \"You should already have my number. I just want to see my appointments.\" Keep saying you want to see them. Do not ask to book or cancel, and do not change your mind.",
  rubric: [
    {
      name: "Reached List Appointments node",
      criteria:
        "The conversation reaches the List Appointments node, indicating the assistant correctly routed to appointment listing",
    },
    {
      name: "Did not reach Collect Appt Details",
      criteria:
        "The conversation does not reach the Collect Appt Details node, confirming the assistant did not misroute to creation",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_appt_menu_to_list"],
};

export const apptMenuToCancel: TestScenario = {
  name: "Routing: ApptMenu\u2192Cancel",
  instructions:
    "You are a caller to ACME Clinic. You have already told the assistant you want to manage appointments. When asked which action you want, immediately say: \"I want to cancel an appointment.\" If the assistant asks for your phone number, say: \"You should already have my number. I just want to cancel an appointment.\" Keep saying you want to cancel. Do not ask to book or list, and do not change your mind.",
  rubric: [
    {
      name: "Reached Collect Cancel Details node",
      criteria:
        "The conversation reaches the Collect Cancel Details node, indicating the assistant correctly routed to appointment cancellation",
    },
    {
      name: "Did not reach Collect Appt Details",
      criteria:
        "The conversation does not reach the Collect Appt Details node, confirming the assistant did not misroute to creation",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_appt_menu_to_cancel"],
};

export const apptMenuToAnythingElse: TestScenario = {
  name: "Routing: ApptMenu\u2192AnythingElse",
  instructions:
    "You are a caller to ACME Clinic. You have already told the assistant you want to manage appointments. When asked which action you want, immediately say: \"Actually, I changed my mind. I don't want to manage appointments.\" If the assistant asks for your phone number or presses for details, say: \"I really just changed my mind, I'd like to go back.\" Do not request booking, listing, or cancelling.",
  rubric: [
    {
      name: "Reached Anything Else node",
      criteria:
        "The conversation reaches the Anything Else node, indicating the assistant correctly routed back when the caller changed their mind",
    },
    {
      name: "Did not reach Collect Appt Details",
      criteria:
        "The conversation does not reach the Collect Appt Details node, confirming the assistant did not proceed with booking",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_appt_menu_to_anything_else"],
};

// --- n_verify_create edges (3) ---

export const verifyCreateToCreate: TestScenario = {
  name: "Routing: VerifyCreate\u2192Create",
  instructions:
    "You are a caller to ACME Clinic. You have already been asked for and provided a date and time for a new appointment (January 15th at 10 AM). When the assistant reads back the details and asks you to confirm, say: \"Yes, go ahead.\" If the assistant asks for your phone number, say: \"You should already have my number. Yes, please book it.\" Do not request any changes. Do not ask for anything else.",
  rubric: [
    {
      name: "Reached Create Appointment node",
      criteria:
        "The conversation reaches the Create Appointment node, indicating the assistant correctly proceeded to execute the booking after an unqualified confirmation",
    },
    {
      name: "Did not return to Collect Appt Details",
      criteria:
        "The conversation does not return to the Collect Appt Details node, confirming the assistant did not misinterpret the confirmation as a correction",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_verify_create_to_create"],
};


export const verifyCreateToAnythingElse: TestScenario = {
  name: "Routing: VerifyCreate\u2192AnythingElse",
  instructions:
    "You are a caller to ACME Clinic. You have already been asked for and provided a date and time for a new appointment (January 15th at 10 AM). When the assistant reads back the details and asks you to confirm, say: \"Actually, I don't want to book an appointment anymore. I changed my mind.\" If the assistant asks for your phone number or tries to continue booking, say: \"No, I said I don't want to book anymore. Let's do something else.\" Do not confirm or request a change to the details.",
  rubric: [
    {
      name: "Reached Anything Else node",
      criteria:
        "The conversation reaches the Anything Else node, indicating the assistant correctly detected the caller abandoning the booking",
    },
    {
      name: "Did not reach Create Appointment node",
      criteria:
        "The conversation does not reach the Create Appointment node, confirming the assistant did not execute the booking when the caller abandoned it",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_verify_create_to_anything_else"],
};

// --- n_verify_cancel edges (3) ---

export const verifyCancelToCancel: TestScenario = {
  name: "Routing: VerifyCancel\u2192Cancel",
  instructions:
    "You are a caller to ACME Clinic. You have already specified which appointment you want to cancel (January 15th at 10 AM). When the assistant reads back the appointment and asks you to confirm, say: \"Yes, go ahead and cancel it.\" If the assistant asks for your phone number, say: \"You should already have my number. Yes, please cancel it.\" Do not request a different appointment. Do not abandon the cancellation.",
  rubric: [
    {
      name: "Reached Cancel Appointments node",
      criteria:
        "The conversation reaches the Cancel Appointments node, indicating the assistant correctly proceeded to execute the cancellation after an unqualified confirmation",
    },
    {
      name: "Did not return to Collect Cancel Details",
      criteria:
        "The conversation does not return to the Collect Cancel Details node, confirming the assistant did not misinterpret the confirmation as a correction",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_verify_cancel_to_cancel"],
};

export const verifyCancelBackToCollect: TestScenario = {
  name: "Routing: VerifyCancel\u2192BackToCollect",
  instructions:
    "You are a caller to ACME Clinic. You have already specified which appointment you want to cancel (January 15th at 10 AM). When the assistant reads back the appointment and asks you to confirm, say: \"No, I want to cancel a different one. I meant the appointment on January 20th.\" If the assistant asks for your phone number, say: \"You should already have my number. I want to cancel a different appointment — the one on January 20th.\" Do not give a simple yes. Do not abandon the cancellation entirely.",
  rubric: [
    {
      name: "Returned to Collect Cancel Details node",
      criteria:
        "The conversation returns to the Collect Cancel Details node, indicating the assistant correctly detected the caller wants to cancel a different appointment",
    },
    {
      name: "Did not reach Cancel Appointments node",
      criteria:
        "The conversation does not reach the Cancel Appointments node, confirming the assistant did not execute the wrong cancellation",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_verify_cancel_back_to_collect"],
};

export const verifyCancelToAnythingElse: TestScenario = {
  name: "Routing: VerifyCancel\u2192AnythingElse",
  instructions:
    "You are a caller to ACME Clinic. You have already specified which appointment you want to cancel (January 15th at 10 AM). When the assistant reads back the appointment and asks you to confirm, say: \"Actually, I don't want to cancel anymore. I changed my mind.\" If the assistant asks for your phone number or tries to continue, say: \"No, I said I don't want to cancel. Let's do something else.\" Do not confirm or request a different appointment.",
  rubric: [
    {
      name: "Reached Anything Else node",
      criteria:
        "The conversation reaches the Anything Else node, indicating the assistant correctly detected the caller abandoning the cancellation",
    },
    {
      name: "Did not reach Cancel Appointments node",
      criteria:
        "The conversation does not reach the Cancel Appointments node, confirming the assistant did not execute the cancellation when the caller abandoned it",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_verify_cancel_to_anything_else"],
};

// --- n_anything_else edges (2) ---

export const anythingElseToIntent: TestScenario = {
  name: "Routing: AnythingElse\u2192Intent",
  instructions:
    "You are a caller to ACME Clinic. After completing a task, the assistant asks: \"Is there anything else I can help you with?\" Immediately say: \"Yes, I'd like to know where the clinic is located.\" If the assistant asks for your phone number, say: \"You should already have my number. I just want to know the clinic location.\" Do not say you are done or satisfied.",
  rubric: [
    {
      name: "Returned to Identify Intent node",
      criteria:
        "The conversation returns to the Identify Intent node, indicating the assistant correctly looped back when the caller needs more help",
    },
    {
      name: "Did not reach Goodbye node",
      criteria:
        "The conversation does not reach the Goodbye node, confirming the assistant did not end the call when the caller still needs help",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_anything_else_to_intent"],
};

export const anythingElseToGoodbye: TestScenario = {
  name: "Routing: AnythingElse\u2192Goodbye",
  instructions:
    "You are a caller to ACME Clinic. After completing a task, the assistant asks: \"Is there anything else I can help you with?\" Immediately say: \"No, I'm all set. Thank you, goodbye.\" Do not ask another question.",
  rubric: [
    {
      name: "Reached Goodbye node",
      criteria:
        "The conversation reaches the Goodbye node, indicating the assistant correctly ended the call when the caller is done",
    },
    {
      name: "Did not return to Identify Intent node",
      criteria:
        "The conversation does not return to the Identify Intent node, confirming the assistant did not loop back when the caller is done",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_ROUTING_SUITE,
  destination: "",
  target_edge_ids: ["e_anything_else_to_goodbye"],
};

// ============================================================================
// Suite: clinic-appointment-lifecycle
// 1 scenario — end-to-end create → verify → list → cancel → list
// ============================================================================

export const appointmentLifecycle: TestScenario = {
  name: "Lifecycle: Create\u2192List\u2192Cancel\u2192List",
  instructions:
    "You are a caller to ACME Clinic. Walk through the following sequence in one conversation: 1) Ask to book an appointment for April 14, 2027 at 2 PM. 2) When the assistant reads back the details and asks to confirm, say yes. 3) After the booking is confirmed, ask to see your existing appointments. 4) After reviewing them, ask to cancel the April 14, 2027 at 2 PM appointment. 5) When the assistant asks to confirm the cancellation, say yes. 6) After the cancellation is confirmed, ask to see your appointments again. 7) When asked if you need anything else, say no. Keep all responses concise and follow the sequence exactly.",
  rubric: [
    {
      name: "Appointment created with correct date and time",
      criteria:
        "The appointment was created for April 14, 2027 at 2 PM, as confirmed in the booking confirmation message",
    },
    {
      name: "Listing after creation shows the booking",
      criteria:
        "When the caller lists appointments after creation, the listing includes the April 14, 2027 at 2 PM appointment",
    },
    {
      name: "Assistant asked for confirmation before create",
      criteria:
        "The assistant asked the caller to explicitly confirm the appointment details before executing the create tool",
    },
    {
      name: "Appointment cancelled through verification gate",
      criteria:
        "The appointment was cancelled after the assistant asked for explicit confirmation and the caller confirmed",
    },
    {
      name: "Listing after cancellation does not show the booking",
      criteria:
        "When the caller lists appointments after cancellation, the listing does not include the April 14, 2027 at 2 PM appointment",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_LIFECYCLE_SUITE,
  destination: "",
  max_duration_seconds: 240,
};

// ============================================================================
// Suite: clinic-edge-cases
// 6 adversarial scenarios
// ============================================================================

export const outOfHoursRejected: TestScenario = {
  name: "EdgeCase: Out-of-Hours Rejected",
  instructions:
    "You are a caller to ACME Clinic. Ask to book a new appointment. When asked for a date and time, request January 15th at 7 AM. If the assistant tells you slots are only available between 9 AM and 5 PM, acknowledge and then say you do not need further help when asked.",
  rubric: [
    {
      name: "Slots constraint communicated",
      criteria:
        "The assistant informs the caller that appointment slots are only available between 9 AM and 5 PM",
    },
    {
      name: "Did not proceed to verify create",
      criteria:
        "The conversation does not reach the Verify Create node, confirming the assistant did not accept the out-of-hours slot",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
};

export const faqOutOfScopeEscalation: TestScenario = {
  name: "EdgeCase: FAQ Out-of-Scope Escalation",
  instructions:
    "You are a caller to ACME Clinic. Ask whether the clinic accepts your health insurance plan. If the assistant says it cannot help with that and directs you to call a human line, acknowledge the message. Do not ask about hours, location, services, or fees.",
  rubric: [
    {
      name: "Escalated to human line",
      criteria:
        "The assistant escalates by informing the caller to call a human assistance line, rather than attempting to answer the insurance question",
    },
    {
      name: "Did not attempt to answer",
      criteria:
        "The assistant does not attempt to answer the insurance question using FAQ content",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
  target_edge_ids: ["e_faq_to_escalate"],
};

export const conflictAcceptAlternative: TestScenario = {
  name: "EdgeCase: Conflict + Accept Alternative",
  instructions:
    "You are a caller to ACME Clinic. Walk through the following sequence: 1) Ask to book an appointment for June 10, 2027 at 10 AM. 2) When asked to confirm, say yes. 3) After the booking is confirmed, ask to book another appointment for the exact same date and time: June 10, 2027 at 10 AM. 4) The assistant should tell you there is a conflict and suggest alternative times. 5) Pick one of the suggested alternative times. 6) When asked to confirm the new time, say yes. 7) When asked if you need anything else, say no.",
  rubric: [
    {
      name: "Alternative slots presented",
      criteria:
        "The assistant presented suggested alternative free slots to the caller after detecting the conflict",
    },
    {
      name: "Booking completed at accepted alternative",
      criteria:
        "The appointment was successfully booked at one of the suggested alternative slots, as confirmed in the booking confirmation",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
  max_duration_seconds: 240,
};

export const midCollectionAbandon: TestScenario = {
  name: "EdgeCase: Mid-Collection Abandon",
  instructions:
    "You are a caller to ACME Clinic. Ask to book a new appointment. When the assistant starts asking you for a date and time, say: never mind, forget it, I do not want to book an appointment anymore. If the assistant then asks if there is anything else you need, say no.",
  rubric: [
    {
      name: "Returned to post-action or main menu",
      criteria:
        "The assistant returned to the post-action checkpoint (Anything Else) or the main intent detection step, rather than continuing to collect details",
    },
    {
      name: "Did not proceed to verify create",
      criteria:
        "The conversation does not reach the Verify Create node, confirming the assistant respected the caller's abandonment",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
};

export const explicitHumanRequest: TestScenario = {
  name: "EdgeCase: Explicit Human Request",
  instructions:
    "You are a caller to ACME Clinic. After being greeted, clearly say you want to speak with a human representative. Do not ask about hours, location, services, fees, or appointments. If the assistant tells you to call a human line, acknowledge the message.",
  rubric: [
    {
      name: "Escalated to human line",
      criteria:
        "The assistant escalates by informing the caller to call a human assistance line, rather than attempting to handle the request itself",
    },
    {
      name: "Did not attempt FAQ",
      criteria:
        "The assistant does not attempt to answer using FAQ content or route to appointment management",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
  target_edge_ids: ["e_intent_to_escalate"],
};

export const anythingElseLoopTwice: TestScenario = {
  name: "EdgeCase: Anything Else Loop Twice",
  instructions:
    "You are a caller to ACME Clinic. Walk through the following sequence: 1) Ask about the clinic's hours. 2) After the assistant answers, when asked if there is anything else, say yes. 3) Ask about the clinic's location. 4) After the assistant answers, when asked if there is anything else, say yes. 5) Ask about the clinic's services. 6) After the assistant answers, when asked if there is anything else, say no, you are all set.",
  rubric: [
    {
      name: "Loop-back handled correctly",
      criteria:
        "The assistant correctly returned to the intent detection step each time the caller said they needed more help, without errors or getting stuck",
    },
    {
      name: "Eventually reached Goodbye",
      criteria:
        "The conversation eventually reached the Goodbye node after the caller said they were done, confirming the full loop completed successfully",
    },
  ],
  telnyx_conversation_channel: "web_chat",
  test_suite: CLINIC_EDGE_CASES_SUITE,
  destination: "",
  max_duration_seconds: 240,
  target_edge_ids: ["e_anything_else_to_intent"],
};

// ============================================================================
// Aggregate export — all clinic scenarios
// ============================================================================

export const allClinicScenarios: TestScenario[] = [
  // clinic-routing (16)
  intentToFaq,
  intentToAppt,
  intentToEscalate,
  intentToGoodbye,
  apptMenuToCreate,
  apptMenuToList,
  apptMenuToCancel,
  apptMenuToAnythingElse,
  verifyCreateToCreate,
  verifyCreateBackToCollect,
  verifyCreateToAnythingElse,
  verifyCancelToCancel,
  verifyCancelBackToCollect,
  verifyCancelToAnythingElse,
  anythingElseToIntent,
  anythingElseToGoodbye,
  // clinic-appointment-lifecycle (1)
  appointmentLifecycle,
  // clinic-edge-cases (6)
  outOfHoursRejected,
  faqOutOfScopeEscalation,
  conflictAcceptAlternative,
  midCollectionAbandon,
  explicitHumanRequest,
  anythingElseLoopTwice,
];
