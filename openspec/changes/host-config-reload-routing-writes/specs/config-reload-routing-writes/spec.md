# Spec Delta

## Purpose

Defines config-reload behavior for routing writes.

## ADDED Requirements

### Requirement: Conditional reload
The service SHALL issue a config reload only when a write changes a config feed.

#### Scenario: Routing-only write
- **WHEN** a pick updates routing cache only
- **THEN** no config reload is issued

#### Scenario: Feed change
- **WHEN** a write changes a watched config feed
- **THEN** one reload is issued

### Requirement: No duplicate writes
Unchanged guest instructions SHALL NOT be rewritten on every turn.

#### Scenario: Unchanged instruction
- **WHEN** the instruction content is identical
- **THEN** no write occurs
