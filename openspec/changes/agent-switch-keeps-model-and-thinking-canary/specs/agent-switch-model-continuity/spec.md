# Spec Delta

## Purpose

Defines how a chat preserves its model and thinking level when the user switches agents.

## ADDED Requirements

### Requirement: Switch preserves selection
The chat SHALL preserve the current model and thinking level when the user switches agents.

#### Scenario: Switch agent
- **WHEN** a session has a picked model and thinking variant and the user switches agent
- **THEN** the session keeps both values

#### Scenario: Explicit new model
- **WHEN** the user picks a different model while switching
- **THEN** the new model and its thinking variant apply

### Requirement: No redundant annotation
An agent switch that leaves the model unchanged SHALL NOT inject a new routing annotation.

#### Scenario: Unchanged pick
- **WHEN** the switch leaves model and thinking level unchanged
- **THEN** the next prompt carries no new `[modelselect: …]` text
