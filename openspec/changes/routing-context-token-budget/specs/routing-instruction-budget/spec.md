# Spec Delta

## Purpose

Defines a bounded, keyed instruction budget for routing hints.

## ADDED Requirements

### Requirement: Bounded hints
Routing hints SHALL stay within a defined token budget and SHALL NOT be re-emitted unchanged each turn.

#### Scenario: Unchanged routing
- **WHEN** the routing decision is unchanged from the previous turn
- **THEN** no new instruction text is written

#### Scenario: Changed routing
- **WHEN** the routing decision changes
- **THEN** the keyed instruction is updated once

### Requirement: Visibility
Fallback and failover SHALL be visible in Work Status rather than injected into the prompt.

#### Scenario: Failover
- **WHEN** a turn fails over
- **THEN** Work Status shows the failover and the prompt text is unchanged
