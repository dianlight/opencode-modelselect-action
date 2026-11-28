# Spec Delta

## Purpose

Defines immediate cleanup when a shared event subscription is aborted.

## ADDED Requirements

### Requirement: Immediate stop
An aborted shared event subscription SHALL stop without further retry timers.

#### Scenario: Abort
- **WHEN** the host aborts a subscription
- **THEN** no further subscription retry is scheduled

#### Scenario: Dropped connection
- **WHEN** the subscription drops without abort
- **THEN** reconnection proceeds as before

### Requirement: No stale signals
Status and quota consumers SHALL NOT emit updates from an aborted subscription.

#### Scenario: Late event
- **WHEN** an event arrives after abort
- **THEN** the consumer ignores it
