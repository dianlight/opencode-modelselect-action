# Spec Delta

## Purpose

Defines fixed-word activity summaries and the lifecycle of a running fold.

## ADDED Requirements

### Requirement: Fixed-word summary
The extension SHALL render routing activity as a short fixed-word summary with detail behind it.

#### Scenario: Failover
- **WHEN** a turn fails over between providers
- **THEN** the activity row shows a short failover summary and retains both provider names in detail

#### Scenario: Quiet turn
- **WHEN** no routing decision occurred
- **THEN** no routing summary row is added

### Requirement: Fold lifecycle
A running fold SHALL close when the host closes it.

#### Scenario: Host closes fold
- **WHEN** the host closes a running fold
- **THEN** the extension removes its row instead of keeping a stale entry
