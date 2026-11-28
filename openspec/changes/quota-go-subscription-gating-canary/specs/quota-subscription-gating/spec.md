# Spec Delta

## Purpose

Defines how OpenCode Go quota is shown only to accounts that have a Go subscription.

## ADDED Requirements

### Requirement: Subscription gate
The Go quota provider SHALL be reported only for accounts with an OpenCode Go subscription.

#### Scenario: No subscription
- **WHEN** the account has no Go subscription
- **THEN** the Go quota row is hidden while other quota rows remain

#### Scenario: Subscribed
- **WHEN** the account has a Go subscription
- **THEN** the Go quota row is shown with its normal windows

### Requirement: No heuristic label
The service SHALL NOT derive Go subscription state from the presence of a quota window.

#### Scenario: Window without subscription
- **WHEN** a Go window is cached but the host reports no subscription
- **THEN** the row stays hidden
