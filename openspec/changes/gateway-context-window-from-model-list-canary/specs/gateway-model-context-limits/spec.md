# Spec Delta

## Purpose

Defines how context and completion limits come from gateway model lists.

## ADDED Requirements

### Requirement: Gateway limits
The runtime SHALL use `context_length` and `max_completion_tokens` from the gateway model list when present.

#### Scenario: Limits published
- **WHEN** a gateway model lists both fields
- **THEN** the budget uses those values

#### Scenario: Limits absent
- **WHEN** a gateway model omits both fields
- **THEN** a documented fallback is used and recorded as such

### Requirement: No hard-coded virtual limits
The runtime SHALL NOT use fixed 2,000,000 and 128,000 virtual limits when the gateway has no entry.

#### Scenario: Catalog miss
- **WHEN** no gateway entry is available for a virtual model
- **THEN** the miss is recorded and no invented limit is reported as authoritative
