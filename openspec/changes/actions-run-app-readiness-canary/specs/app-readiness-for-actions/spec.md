# Spec Delta

## Purpose

Defines how extension actions wait for the host application before running.

## ADDED Requirements

### Requirement: Action readiness
The extension SHALL rely on the host to run actions only after the app is ready.

#### Scenario: App starting
- **WHEN** an action is invoked while the app is starting
- **THEN** the host waits and runs it once ready

#### Scenario: App ready
- **WHEN** the app is already up
- **THEN** the action runs without a forced reload

### Requirement: No port guessing
The service SHALL NOT guess OpenCode server ports or POST defensive reloads after config writes.

#### Scenario: Port env absent
- **WHEN** no port environment variable is set
- **THEN** no port guess or reload is attempted
