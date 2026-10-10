# Spec Delta

## Purpose

Manages the Telnyx AI Assistant configuration — the agent settings, conversation workflow graph, dynamic variable defaults, and MCP server references — plus the tooling to load, validate, and deploy this configuration to the Telnyx Assistants API.

## ADDED Requirements

### Requirement: Assistant Configuration File

The system SHALL provide a JSON configuration file that represents the complete Telnyx `CreateAssistantRequest` payload, including agent name, instructions, model, dynamic variable defaults, MCP server reference placeholders, and a conversation workflow graph.

#### Scenario: Config file is valid API payload
- **WHEN** the configuration file is loaded
- **THEN** it contains the required `name` and `instructions` fields accepted by the Telnyx Assistants create endpoint

#### Scenario: Config includes dynamic variable defaults
- **WHEN** the configuration file is loaded
- **THEN** it includes a `dynamic_variables` map with default values matching the fields the edge webhook returns, so unresolved variables fall back gracefully

#### Scenario: Config includes MCP server placeholder
- **WHEN** the configuration file is loaded
- **THEN** it contains an `mcp_servers` array (possibly empty) ready to receive MCP server IDs

### Requirement: Workflow Graph Structure

The conversation workflow in the configuration SHALL include at least one speak node for verbatim messages, multiple prompt nodes for LLM-driven steps, and edges using `default`, `llm` condition, and `expression` (variable comparison) condition types.

#### Scenario: Speak node present
- **WHEN** the workflow configuration is loaded
- **THEN** it contains at least one node with `type: "speak"` whose `message` field is defined

#### Scenario: Multiple prompt nodes present
- **WHEN** the workflow configuration is loaded
- **THEN** it contains at least two nodes with `type: "prompt"` (or no type, defaulting to prompt), each with `instructions`

#### Scenario: LLM condition edge present
- **WHEN** the workflow configuration is loaded
- **THEN** at least one edge has a condition with `type: "llm"` and a non-empty `prompt`

#### Scenario: Variable comparison edge present
- **WHEN** the workflow configuration is loaded
- **THEN** at least one edge has a condition with `type: "expression"` containing a comparison on a dynamic variable

#### Scenario: Default edge present
- **WHEN** the workflow configuration is loaded
- **THEN** at least one edge has a condition with `type: "default"` leaving a speak or tool node

### Requirement: Instructions Mode Default

Prompt nodes without an explicit `instructions_mode` SHALL use `append` mode, adding the node's instructions on top of the assistant's base instructions rather than replacing them.

#### Scenario: Append mode when omitted
- **WHEN** a prompt node in the configuration has no `instructions_mode` field
- **THEN** the node uses append mode when submitted to the Telnyx API

#### Scenario: Replace mode when explicit
- **WHEN** a prompt node in the configuration sets `instructions_mode` to `replace`
- **THEN** the node's instructions replace the assistant's base instructions for that step

### Requirement: Configuration Validation

The system SHALL validate the workflow graph before deployment and SHALL reject configurations where the start node does not exist, an edge references a non-existent source or target node, a speak node lacks exactly one outgoing default edge, a tool node with outgoing edges lacks exactly one default edge, node or edge IDs are not unique, or required fields (`name`, `instructions`) are empty.

#### Scenario: Valid configuration passes
- **WHEN** validation runs against a configuration with a valid graph
- **THEN** it returns a success result with no errors

#### Scenario: Missing start node rejected
- **WHEN** the `start_node_id` references a node ID not present in `nodes`
- **THEN** validation fails with an error message naming the missing node

#### Scenario: Speak node with no default edge rejected
- **WHEN** a speak node has zero or more than one outgoing default edge
- **THEN** validation fails with an error naming the speak node and the constraint violated

#### Scenario: Duplicate node IDs rejected
- **WHEN** two or more nodes share the same `id`
- **THEN** validation fails with an error listing the duplicate ID

#### Scenario: Edge to non-existent target rejected
- **WHEN** an edge's `target.node_id` references a node not in the graph
- **THEN** validation fails with an error naming the edge and the missing target

### Requirement: Integrated Assistant Deployment

The deploy script SHALL push the assistant configuration to the Telnyx Assistants API after the edge function deployment succeeds, using the deployed edge function URL as the `dynamic_variables_webhook_url`.

#### Scenario: Full deploy pushes both edge and assistant
- **WHEN** the deploy script runs successfully through the edge deployment phase
- **THEN** it loads the assistant config, injects the edge webhook URL, and forwards the config to the Telnyx Assistants API

#### Scenario: Assistant deploy skipped when edge fails
- **WHEN** the edge deployment phase fails
- **THEN** the assistant deployment does not proceed

#### Scenario: Webhook URL injected from edge deployment
- **WHEN** the edge function is deployed to `https://<name>.telnyxcompute.com`
- **THEN** the config's `dynamic_variables_webhook_url` is set to `https://<name>.telnyxcompute.com/webhook` before pushing to the Assistants API

### Requirement: Idempotent Redeploys

The deploy script SHALL update the existing assistant on subsequent deploys rather than creating duplicates, using a cached assistant ID stored in a local gitignored file.

#### Scenario: First deploy creates a new assistant
- **WHEN** no cached assistant ID exists
- **THEN** the deploy creates a new assistant via the Telnyx API and caches the returned ID

#### Scenario: Subsequent deploys update existing assistant
- **WHEN** a cached assistant ID exists from a prior deploy
- **THEN** the deploy updates the existing assistant with the new config instead of creating a new one

### Requirement: Standalone Assistant Deploy

The system SHALL support deploying the assistant configuration independently of the edge function via a separate script that accepts an explicit webhook URL or reads a cached edge deployment URL.

#### Scenario: Deploy with explicit webhook URL
- **WHEN** the standalone deploy script is invoked with a `--webhook-url` flag
- **THEN** it loads the config, injects the provided URL, validates, and pushes to the Telnyx API

#### Scenario: Deploy with cached edge URL
- **WHEN** the standalone deploy script is invoked without a `--webhook-url` flag and a cached edge URL exists
- **THEN** it uses the cached URL as the webhook URL

#### Scenario: Deploy without any URL fails with guidance
- **WHEN** the standalone deploy script is invoked without a `--webhook-url` flag and no cached edge URL exists
- **THEN** it exits with an error instructing the user to provide `--webhook-url` or run the full deploy first

### Requirement: Dynamic Variables Webhook Response Shape

The webhook endpoint SHALL return dynamic variables wrapped under a top-level `dynamic_variables` key in the JSON response body, as required by the Telnyx AI Assistant dynamic variables specification.

#### Scenario: Response wraps variables under dynamic_variables
- **WHEN** the webhook endpoint processes a request from the Telnyx AI Assistant
- **THEN** the JSON response body contains a `dynamic_variables` object with the computed variable values

#### Scenario: Error responses exclude dynamic_variables
- **WHEN** the webhook endpoint encounters an internal error
- **THEN** the response body contains an `error` field and does not include a `dynamic_variables` object

### Requirement: Telnyx SDK Client

The assistant client SHALL use the `telnyx` SDK for all create, update, and retrieve assistant operations rather than hand-rolled HTTP calls.

#### Scenario: Create assistant via SDK
- **WHEN** a new assistant is created
- **THEN** the client calls the `telnyx` SDK's assistant create method with the config payload

#### Scenario: Update assistant via SDK
- **WHEN** an existing assistant is updated
- **THEN** the client calls the `telnyx` SDK's assistant update method with the assistant ID and config

#### Scenario: API key read from environment
- **WHEN** the client is initialized
- **THEN** it reads the `TELNYX_API_KEY` from the process environment and fails if it is not set
