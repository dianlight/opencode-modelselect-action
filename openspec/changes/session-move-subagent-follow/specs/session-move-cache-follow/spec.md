# Spec Delta

## Purpose

Defines how routing and status caches follow a session that moves with its subagents.

## ADDED Requirements

### Requirement: Cache follows session
Routing and status cache SHALL follow a moved session and its subagents.

#### Scenario: Move session
- **WHEN** a session with subagents moves to another project
- **THEN** its caches are readable at the new location

#### Scenario: Old location
- **WHEN** the session has moved
- **THEN** no stale status row remains at the old location

### Requirement: Subagent inheritance
Subagents SHALL keep the routing state they inherited from the parent after the move.

#### Scenario: Subagent after move
- **WHEN** a subagent had an inherited model
- **THEN** the same model applies after the move
