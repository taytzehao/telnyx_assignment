# Spec Delta

## Purpose

Defines the externally observable behavior of the ACME Clinic voice AI assistant — greeting callers, answering FAQs, and managing per-caller appointments with conflict detection and verification — as experienced by a caller phoning the clinic.

## ADDED Requirements

### Requirement: Greeting
The system SHALL deliver a verbatim, personalized greeting to every caller at the start of the call, identifying the clinic as ACME Clinic. Returning callers SHALL receive a distinct greeting acknowledging their return.

#### Scenario: First-time caller
- **WHEN** a caller who has never called before connects
- **THEN** the system speaks a verbatim welcome to ACME Clinic and proceeds to ask what the caller needs

#### Scenario: Returning caller
- **WHEN** a caller whose phone number has called before connects
- **THEN** the system speaks a verbatim welcome-back message that acknowledges this is a repeat call and proceeds to ask what the caller needs

### Requirement: Intent classification
The system SHALL detect why the caller is calling and route the conversation accordingly. Supported intents are: FAQ question, appointment management, escalation to human, or no help needed.

#### Scenario: Caller asks a FAQ question
- **WHEN** the caller asks about hours, location, services, or fees
- **THEN** the system routes to the FAQ answering step

#### Scenario: Caller wants appointment management
- **WHEN** the caller says they want to book, view, or cancel an appointment
- **THEN** the system routes to the appointment menu step

#### Scenario: Caller requests out-of-scope help
- **WHEN** the caller asks for something the bot cannot handle
- **THEN** the system routes to the escalation step

#### Scenario: Caller does not need help
- **WHEN** the caller states they do not need any assistance
- **THEN** the system routes to a thank-you and ends the call

### Requirement: FAQ answering
The system SHALL answer caller questions in four categories: hours, location, services, and fees. If the caller's question falls outside these categories, the system SHALL escalate to a human.

#### Scenario: Caller asks about hours
- **WHEN** the caller asks when the clinic is open
- **THEN** the system retrieves and speaks the hours FAQ content

#### Scenario: Caller asks about location
- **WHEN** the caller asks where the clinic is
- **THEN** the system retrieves and speaks the location FAQ content

#### Scenario: Caller asks about services
- **WHEN** the caller asks what services the clinic offers
- **THEN** the system retrieves and speaks the services FAQ content

#### Scenario: Caller asks about fees
- **WHEN** the caller asks about pricing or fees
- **THEN** the system retrieves and speaks the fees FAQ content

#### Scenario: Caller asks an unsupported FAQ question
- **WHEN** the caller asks a question that is not about hours, location, services, or fees
- **THEN** the system escalates to a human

### Requirement: Appointment menu
The system SHALL ask the caller which appointment action they want: create, list, or cancel. The system SHALL route based on the caller's response. If the caller changes their mind, the system SHALL return to the main intent step.

#### Scenario: Caller chooses to create
- **WHEN** the caller says they want to book a new appointment
- **THEN** the system routes to the appointment detail collection step

#### Scenario: Caller chooses to list
- **WHEN** the caller says they want to see their existing appointments
- **THEN** the system routes to the list appointments step

#### Scenario: Caller chooses to cancel
- **WHEN** the caller says they want to cancel an appointment
- **THEN** the system routes to the cancellation detail collection step

#### Scenario: Caller changes their mind
- **WHEN** the caller decides they do not want appointment management after all
- **THEN** the system returns to the main intent step

### Requirement: Appointment slot constraints
All appointments SHALL be 30-minute slots within the 9 AM–5 PM range. The system SHALL reject any requested slot outside this range.

#### Scenario: Valid slot
- **WHEN** the caller requests a 30-minute slot between 9 AM and 5 PM
- **THEN** the system accepts the slot for booking

#### Scenario: Slot outside range
- **WHEN** the caller requests a slot outside 9 AM–5 PM
- **THEN** the system informs the caller that slots are only available between 9 AM and 5 PM

### Requirement: Appointment creation
The system SHALL create a new appointment for the current caller at the requested date and slot. If another appointment for the same caller overlaps the requested slot, the system SHALL detect the conflict, inform the caller, and suggest nearby free slots.

#### Scenario: Successful creation
- **WHEN** the caller requests a slot with no existing conflict for that caller
- **THEN** the system creates the appointment and confirms the booking details

#### Scenario: Conflict detected
- **WHEN** the caller requests a slot that overlaps an existing appointment for that caller
- **THEN** the system informs the caller of the conflict and suggests nearby free 30-minute slots in the 9 AM–5 PM range

#### Scenario: Caller accepts a suggested alternative
- **WHEN** the caller picks one of the suggested alternative slots
- **THEN** the system proceeds to book the appointment at the chosen alternative slot

#### Scenario: Caller rejects alternatives
- **WHEN** the caller does not want any of the suggested slots and wants a different time
- **THEN** the system returns to appointment detail collection to gather a new date and slot

### Requirement: Appointment listing
The system SHALL list all appointments belonging to the current caller and read them aloud.

#### Scenario: Caller has appointments
- **WHEN** the caller has one or more existing appointments
- **THEN** the system reads out each appointment's date and time to the caller

#### Scenario: Caller has no appointments
- **WHEN** the caller has no existing appointments
- **THEN** the system informs the caller that they have no appointments

### Requirement: Appointment cancellation
The system SHALL cancel appointments for the current caller by either a specific date/time slot or a specific appointment ID. The system SHALL confirm what was cancelled.

#### Scenario: Cancel by specific time
- **WHEN** the caller specifies a date and time slot to cancel
- **THEN** the system cancels the matching appointment and confirms the cancellation

#### Scenario: Cancel by appointment ID
- **WHEN** the caller specifies an appointment ID to cancel
- **THEN** the system cancels the matching appointment and confirms the cancellation

#### Scenario: No matching appointment found
- **WHEN** the caller specifies an appointment that does not exist for that caller
- **THEN** the system informs the caller that no matching appointment was found and asks for clarification

### Requirement: Verification before destructive actions
The system SHALL ask the caller to explicitly confirm before creating or cancelling an appointment. If the caller provides feedback to change the details, the system SHALL route back to the collection step with the caller's revised request.

#### Scenario: Caller confirms creation
- **WHEN** the system reads back the proposed appointment details and the caller confirms
- **THEN** the system proceeds to execute the appointment creation

#### Scenario: Caller corrects creation details
- **WHEN** the system reads back the proposed appointment details and the caller wants to change something
- **THEN** the system returns to the appointment detail collection step with the caller's feedback

#### Scenario: Caller confirms cancellation
- **WHEN** the system reads back the appointment to cancel and the caller confirms
- **THEN** the system proceeds to execute the cancellation

#### Scenario: Caller changes cancellation target
- **WHEN** the system reads back the appointment to cancel and the caller wants to cancel a different appointment instead
- **THEN** the system returns to the cancellation detail collection step with the caller's feedback

#### Scenario: Caller abandons the action
- **WHEN** the caller no longer wants to create or cancel and wants something else
- **THEN** the system routes back to the post-action checkpoint step

### Requirement: Human escalation
When the caller's request cannot be handled by the bot, the system SHALL inform the caller to call a human assistance line. The system SHALL then end the call.

#### Scenario: Caller requests a human
- **WHEN** the caller explicitly asks to speak with a human
- **THEN** the system informs the caller to call the human line and proceeds to end the call

#### Scenario: FAQ out of scope
- **WHEN** the caller asks a question that is not about hours, location, services, or fees
- **THEN** the system escalates by informing the caller to call the human line and proceeds to end the call

#### Scenario: Caller acknowledges escalation
- **WHEN** the caller acknowledges the escalation message
- **THEN** the system speaks a verbatim thank-you and ends the call

### Requirement: Post-action checkpoint
After completing any action (FAQ answer, appointment create, appointment list, or appointment cancel), the system SHALL ask whether the caller needs any more help. If yes, the system SHALL route back to intent detection. If no, the system SHALL end the call.

#### Scenario: Caller needs more help
- **WHEN** the caller says they need additional assistance
- **THEN** the system routes back to the intent detection step

#### Scenario: Caller is done
- **WHEN** the caller says they do not need further help
- **THEN** the system routes to a verbatim thank-you and ends the call

### Requirement: Call termination
The system SHALL deliver a verbatim thank-you goodbye message and then hang up the call when the conversation is complete.

#### Scenario: Normal call end
- **WHEN** the caller indicates they are done and the goodbye step is reached
- **THEN** the system speaks the verbatim thank-you message and hangs up the call

### Requirement: Per-caller appointment isolation
All appointment operations (create, list, cancel) SHALL be scoped to the current caller's identity. The system SHALL NOT allow one caller to view, create, or cancel another caller's appointments.

#### Scenario: Create is caller-scoped
- **WHEN** the caller creates an appointment
- **THEN** the appointment is stored under that caller's identity only

#### Scenario: List is caller-scoped
- **WHEN** the caller asks to list appointments
- **THEN** the system returns only appointments belonging to that caller

#### Scenario: Cancel is caller-scoped
- **WHEN** the caller cancels an appointment
- **THEN** the system only matches and cancels appointments belonging to that caller

### Requirement: MCP tool exposure
The system SHALL expose four MCP tools that workflow nodes can call: one for FAQ retrieval, one for appointment creation, one for appointment listing, and one for appointment cancellation.

#### Scenario: FAQ tool call
- **WHEN** the FAQ answering node calls the FAQ tool with a category
- **THEN** the tool returns the FAQ content for that category

#### Scenario: Appointment creation tool call
- **WHEN** the appointment creation tool node calls the create tool with caller number, date, and start time
- **THEN** the tool returns either a success result with the appointment details or a conflict result with conflict information and suggestions

#### Scenario: Appointment listing tool call
- **WHEN** the appointment listing tool node calls the list tool with caller number
- **THEN** the tool returns all appointments for that caller

#### Scenario: Appointment cancellation tool call
- **WHEN** the appointment cancellation tool node calls the cancel tool with caller number and cancellation criteria
- **THEN** the tool returns the cancelled appointment details or a not-found result

### Requirement: Dynamic webhook variables
The system SHALL provide dynamic variables via a webhook endpoint on every workflow node entry, including at minimum: a personalized greeting, whether the caller is returning, and an escalation feature flag. These variables SHALL be usable in speak node messages and for workflow routing.

#### Scenario: Personalized greeting variable
- **WHEN** a call begins and the caller is identified
- **THEN** the webhook returns a greeting variable that the greeting speak node interpolates verbatim

#### Scenario: Returning caller variable
- **WHEN** the webhook is called for a caller who has called before
- **THEN** the webhook returns a returning-caller flag that can route the conversation differently

#### Scenario: Escalation feature flag variable
- **WHEN** the webhook is called
- **THEN** the webhook returns an escalation-enabled flag derived from a stored feature flag that can gate escalation routing

### Requirement: Observability
The system SHALL emit a structured log entry on every webhook call and every MCP tool call, each including the caller identity, the node or tool involved, and the outcome. The system SHALL also measure and log the latency of each call.

#### Scenario: Webhook call logged
- **WHEN** the dynamic variables webhook is invoked
- **THEN** the system emits a structured JSON log entry containing the caller, node, outcome, and latency

#### Scenario: MCP tool call logged
- **WHEN** any MCP tool is called
- **THEN** the system emits a structured JSON log entry containing the caller, tool name, outcome, and latency
