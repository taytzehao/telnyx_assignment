# Spec Delta

## ADDED Requirements

### Requirement: Clinic Routing Scenario Library

The system SHALL provide a test scenario for each high-value LLM-conditioned routing edge in the clinic conversation workflow. Each routing scenario SHALL carry a caller persona that triggers exactly one routing edge and a dual-criterion rubric asserting both that the conversation reached the expected target node and that it did not diverge to the nearest sibling node.

#### Scenario: Intent routed to FAQ

- **WHEN** a scenario with a caller persona asking about clinic hours is run against the deployed assistant
- **THEN** the rubric asserts the conversation reached the FAQ answering node and did not route to the escalation node

#### Scenario: Appointment menu routed to create

- **WHEN** a scenario with a caller persona requesting to book a new appointment is run
- **THEN** the rubric asserts the conversation reached the appointment detail collection node and did not route to the list or cancel nodes

#### Scenario: Verify create routed back to collect on correction

- **WHEN** a scenario with a caller persona that confirms the booking then changes the requested time is run
- **THEN** the rubric asserts the conversation returned to the appointment detail collection node and did not execute the create tool

#### Scenario: Anything else routed to intent on more help

- **WHEN** a scenario with a caller persona that says they need additional help is run
- **THEN** the rubric asserts the conversation returned to the intent detection node and did not route to the goodbye node

### Requirement: Appointment Lifecycle Scenario

The system SHALL provide an end-to-end test scenario that walks the full appointment lifecycle in a single conversation: creating an appointment through the verification gate, listing to confirm the booking is visible, cancelling through the verification gate, and listing again to confirm the booking is gone.

#### Scenario: Full create-list-cancel-list cycle

- **WHEN** the lifecycle scenario is run against the deployed assistant
- **THEN** the rubric asserts the appointment was created with the requested date and time, appeared in the listing immediately after creation, was cancelled through the verification gate, and was absent from the listing after cancellation

#### Scenario: Verification gate fires before both destructive actions

- **WHEN** the lifecycle scenario conversation reaches the create and cancel steps
- **THEN** the rubric asserts the assistant asked for explicit confirmation before executing the create tool and before executing the cancel tool

### Requirement: Clinic Edge Case Scenarios

The system SHALL provide adversarial test scenarios covering: appointment slot outside the 9 AM–5 PM range, FAQ question outside supported categories, appointment conflict with acceptance of a suggested alternative, caller abandoning mid-collection, explicit request for a human agent, and the "anything else?" loop exercising multiple rounds of intent detection.

#### Scenario: Out-of-hours slot rejected

- **WHEN** a scenario with a caller persona requesting a 7 AM appointment is run
- **THEN** the rubric asserts the assistant informed the caller that slots are only available between 9 AM and 5 PM and did not proceed to the verify create node

#### Scenario: FAQ out-of-scope escalation

- **WHEN** a scenario with a caller persona asking about insurance (outside hours, location, services, fees) is run
- **THEN** the rubric asserts the assistant escalated to the human line and did not attempt to answer the question

#### Scenario: Conflict with accepted alternative

- **WHEN** a scenario with a caller persona that books a slot, then books the same slot again, and accepts a suggested alternative is run
- **THEN** the rubric asserts the assistant presented alternative slots and completed the booking at the accepted alternative

#### Scenario: Mid-collection abandon

- **WHEN** a scenario with a caller persona that says "never mind" while the assistant is collecting appointment details is run
- **THEN** the rubric asserts the assistant returned to the post-action checkpoint or main menu and did not proceed to the verify create node

### Requirement: Edge Target Tagging

Each test scenario MAY declare which conversation-flow edge IDs it covers via a `target_edge_ids` field. The system SHALL use this field to perform a static coverage audit that detects when a new LLM-conditioned edge is added to the workflow without a corresponding eval scenario.

#### Scenario: Routing scenario declares covered edge IDs

- **WHEN** a routing scenario is loaded from the scenario library
- **THEN** it contains a `target_edge_ids` array listing at least one edge ID from the conversation flow definition

#### Scenario: Non-routing scenario without edge IDs is valid

- **WHEN** a non-routing scenario (e.g., the lifecycle scenario) is loaded without a `target_edge_ids` field
- **THEN** the scenario is still valid and the coverage audit does not flag it

### Requirement: Scenario Subset Selection

The eval CLI SHALL accept `--suite <name>` and `--scenario <name>` flags that narrow which scenarios run on a given invocation, and SHALL print a summary matrix of per-criterion results across all selected scenarios at the end of the run.

#### Scenario: Filter by test suite

- **WHEN** the CLI is invoked with `--suite clinic-routing`
- **THEN** only scenarios belonging to the `clinic-routing` test suite are executed and the summary matrix lists results for those scenarios only

#### Scenario: Filter by scenario name

- **WHEN** the CLI is invoked with `--scenario "Routing: Intent to FAQ"`
- **THEN** only the named scenario is executed and its results are printed

#### Scenario: Default runs all scenarios

- **WHEN** the CLI is invoked without `--suite` or `--scenario` flags
- **THEN** all scenarios across all test suites are executed and the summary matrix aggregates results for every scenario

#### Scenario: Summary matrix reports per-criterion results

- **WHEN** the CLI finishes executing all selected scenarios
- **THEN** it prints a matrix showing each scenario name, each rubric criterion, and its pass/fail status, plus a total pass count and exit code

### Requirement: Edge Coverage Guardrail

The system SHALL validate that every LLM-conditioned edge in the conversation workflow definition is referenced by at least one scenario's `target_edge_ids`, and SHALL fail the test suite if any LLM-conditioned edge lacks coverage.

#### Scenario: All LLM edges covered

- **WHEN** the coverage guardrail runs and every LLM-conditioned edge in the conversation flow is referenced by at least one scenario
- **THEN** the guardrail passes silently

#### Scenario: Uncovered LLM edge detected

- **WHEN** the coverage guardrail runs and an LLM-conditioned edge in the conversation flow is not referenced by any scenario's `target_edge_ids`
- **THEN** the guardrail fails and names the uncovered edge so the developer can add a scenario

#### Scenario: Non-LLM edges excluded from coverage requirement

- **WHEN** the coverage guardrail runs and encounters default-condition or expression-condition edges in the conversation flow
- **THEN** those edges are not required to be covered by a scenario's `target_edge_ids`
