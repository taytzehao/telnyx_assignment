# Spec Delta

## Purpose

Automated evaluation of the AI Assistant's conversation workflow using the Telnyx Assistant Tests API — defines test-agent scenarios (caller personas), evaluator rubric criteria (routing correctness), caches test configs for idempotent re-runs, and orchestrates run execution with polling and per-criterion result reporting.

## ADDED Requirements

### Requirement: Test Scenario Definition

The system SHALL provide a structured test-scenario format that maps a caller persona (test agent) and evaluation criteria (evaluator rubric) to a CreateAssistantTestRequest payload accepted by the Telnyx Assistant Tests API.

#### Scenario: Boilerplate scenario targets the Handle Request routing edge

- **WHEN** the boilerplate scenario is loaded from the scenario definitions module
- **THEN** it contains a `name`, `instructions` field describing a caller persona that asks a handleable question, a `rubric` array with at least one routing-correctness criterion, and a `destination` pointing to the deployed assistant

#### Scenario: Scenario produces a valid API request payload

- **WHEN** the scenario is converted to a test creation request
- **THEN** the payload includes `name`, `instructions`, `rubric` (array of `{name, criteria}` items), and `telnyx_conversation_channel` matching the Telnyx Assistant Tests API schema

#### Scenario: Scenario groups under a shared test suite

- **WHEN** the boilerplate scenario is created on the Telnyx platform
- **THEN** it is assigned a `test_suite` value so it can be batch-triggered and queried alongside future scenarios

### Requirement: Test Config Caching

The system SHALL cache created test IDs in a local gitignored file keyed by scenario name, so repeated eval runs trigger new runs against existing test configs instead of creating duplicate test definitions.

#### Scenario: First run creates and caches the test ID

- **WHEN** no cached test ID exists for the scenario name
- **THEN** the runner creates a new test on the Telnyx API, stores the returned `test_id` in the cache file keyed by scenario name, and proceeds to trigger a run

#### Scenario: Second run reuses the cached test ID

- **WHEN** a cached test ID exists for the scenario name
- **THEN** the runner skips test creation and triggers a new run directly against the cached `test_id`

#### Scenario: Deleted test is recreated and cache updated

- **WHEN** a cached test ID exists but the test was deleted on the Telnyx side (run trigger returns 404)
- **THEN** the runner creates a new test, updates the cache file with the new `test_id`, and triggers a run against it

### Requirement: Test Run Orchestration

The system SHALL trigger a test run for each scenario and poll the run status until it reaches a terminal state (`passed`, `failed`, or `error`), then report the per-rubric-criterion results.

#### Scenario: Run triggered and polled to completion

- **WHEN** the runner triggers a run for a scenario's test config
- **THEN** it records the `run_id` and polls the run status at a configurable interval until the status is terminal

#### Scenario: Terminal results reported per rubric criterion

- **WHEN** the run reaches a terminal status
- **THEN** the runner reports each rubric criterion's name and its `detail_status` result (passed/failed/error)

#### Scenario: Timeout when run does not reach terminal status

- **WHEN** the run does not reach a terminal status within a configurable maximum wait period
- **THEN** the runner reports a timeout with the last known status and exits with a non-zero exit code

### Requirement: Telnyx SDK Client for Tests API

The eval client SHALL use the `telnyx` SDK for all Assistant Tests API operations rather than hand-rolled HTTP calls.

#### Scenario: Create test via SDK

- **WHEN** a new test config is created
- **THEN** the client calls the `telnyx` SDK's assistant tests create method with the scenario payload and an idempotency key

#### Scenario: Trigger run via SDK

- **WHEN** a run is triggered for an existing test
- **THEN** the client calls the `telnyx` SDK's test runs trigger method with the `test_id`

#### Scenario: Retrieve run via SDK

- **WHEN** the runner polls for run status
- **THEN** the client calls the `telnyx` SDK's test runs retrieve method with both `test_id` and `run_id`

#### Scenario: API key read from environment

- **WHEN** the eval client is initialized
- **THEN** it reads the `TELNYX_API_KEY` from the process environment and fails if it is not set

### Requirement: CLI Entry Point

The system SHALL provide a CLI script invocable via `npm run eval` that loads the scenario definitions, orchestrates the eval run, and prints results to stdout.

#### Scenario: CLI runs the eval and prints results

- **WHEN** `npm run eval` is executed with `TELNYX_API_KEY` set and the assistant deployed
- **THEN** the script loads the boilerplate scenario, creates or reuses the test config, triggers a run, polls to completion, and prints each rubric criterion's name and pass/fail status

#### Scenario: CLI exits non-zero on failure

- **WHEN** any rubric criterion fails or the run errors out
- **THEN** the CLI exits with a non-zero exit code

#### Scenario: CLI exits non-zero on missing configuration

- **WHEN** `TELNYX_API_KEY` is not set or no assistant destination is configured
- **THEN** the CLI prints a clear error message and exits with a non-zero exit code
