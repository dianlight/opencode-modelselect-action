# Spec Delta

## Purpose

Defines how routing stays silent on compaction-only turns that produce no activity or notifications.

## ADDED Requirements

### Requirement: Silent compaction
The extension SHALL NOT emit routing announcements or Work Status updates for compaction-only turns.

#### Scenario: Compaction turn
- **WHEN** a turn is marked as compaction-only by the host
- **THEN** no routing announcement or status write is produced

#### Scenario: Normal turn
- **WHEN** a turn is not compaction-only
- **THEN** routing announcements and status writes proceed as today

### Requirement: Host-driven detection
Compaction-only detection SHALL use host session events, not prompt text heuristics.

#### Scenario: Ambiguous prompt
- **WHEN** a prompt mentions compaction but the host does not mark the turn
- **THEN** the turn is treated as a normal turn
