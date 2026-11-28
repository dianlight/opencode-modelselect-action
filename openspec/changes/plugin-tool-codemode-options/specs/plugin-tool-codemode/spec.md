# Spec Delta

## Purpose

Defines Code Mode options for the model-pick tool.

## ADDED Requirements

### Requirement: Typed Code Mode
The `model-pick` tool SHALL declare Code Mode options with a description and schema.

#### Scenario: Code Mode call
- **WHEN** a client calls the tool in Code Mode
- **THEN** the task type and tier are validated against the declared schema

#### Scenario: Invalid pick
- **WHEN** a call supplies an unknown tier
- **THEN** the call is rejected without changing the session model

### Requirement: Compatibility
The plain tool surface SHALL remain usable without Code Mode.

#### Scenario: Plain call
- **WHEN** a client calls the tool without Code Mode
- **THEN** the existing argument shape still works
