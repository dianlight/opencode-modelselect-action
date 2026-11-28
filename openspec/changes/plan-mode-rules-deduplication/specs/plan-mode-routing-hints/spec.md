# Spec Delta

## Purpose

Defines deduplication of routing hints in plan mode.

## ADDED Requirements

### Requirement: Deduplication
Routing hints SHALL NOT duplicate plan-mode rules already present in the system prompt.

#### Scenario: Host rules present
- **WHEN** the host supplies plan-mode routing rules
- **THEN** the plugin adds no duplicate hint

#### Scenario: Host rules absent
- **WHEN** the host supplies no plan-mode rules
- **THEN** the plugin's hint is emitted once

### Requirement: Compaction
Hints SHALL NOT be re-emitted after compaction when the host still carries the rules.

#### Scenario: After compaction
- **WHEN** a session compacts with host rules intact
- **THEN** no new routing hint is appended
