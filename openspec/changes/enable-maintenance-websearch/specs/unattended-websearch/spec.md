# Spec Delta

## Purpose

Defines how a configured Web Search provider is supplied to an unattended
OpenCode run so the agent can research current sources without asking the user
to select a provider.

## ADDED Requirements

### Requirement: Explicit search provider skips selection

A non-interactive OpenCode action SHALL write the caller's Web Search provider
configuration into every generated `opencode.json` so Web Search does not ask
for a provider selection at runtime.

#### Scenario: Provider configured for an unattended run

- **WHEN** the caller passes a Web Search provider object as an action input
- **THEN** both generated configs contain that object and the run does not
  request a provider-selection input

### Requirement: Maintenance Web Search uses a repository secret

The OpenCode Maintenance workflow SHALL provide a Web Search API key from a
repository secret and SHALL set the action's Web Search provider to that same
provider when running the unattended coverage-fix agent.

#### Scenario: Coverage-fix agent researches from live sources

- **WHEN** the maintenance workflow dispatches the coverage-fix agent with the
  Web Search provider and its secret configured
- **THEN** the agent can run Web Search to research missing model scores
- **AND** the step completes without a cancelled input request

#### Scenario: Web Search remains disabled without a provider

- **WHEN** the maintenance workflow has no Web Search provider configured
- **THEN** the generated configs keep Web Search disabled
- **AND** the coverage-fix agent continues with direct source fetches only

### Requirement: Invalid search configuration fails closed

The action SHALL reject a Web Search input that is neither `false` nor a
provider-configuration object before it writes any config file.

#### Scenario: Unsupported search input

- **WHEN** the caller passes a non-object, non-`false` Web Search input
- **THEN** the action fails with a descriptive error
- **AND** no generated `opencode.json` is written
