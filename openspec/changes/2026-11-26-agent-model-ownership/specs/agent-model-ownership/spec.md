# Spec Delta

## Purpose

Defines how an agent-owned model override participates in task-first routing.

## ADDED Requirements

### Requirement: An agent keeps its own model

When a session is created for an agent that carries a model override, that
override SHALL be used for the agent's turns and SHALL survive a switch to
another agent that has no override.

#### Scenario: Agent with an override
- **WHEN** a user switches to an agent that has a model override
- **THEN** the override is kept and used for the agent's turns

#### Scenario: Agent without an override
- **WHEN** a user switches to an agent that has no override
- **THEN** routing falls back to the task-type mapping
