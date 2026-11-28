# service-schedule-refresh Specification

## Purpose
Defines how host-scheduled wakes refresh routing and quota data so the service
no longer has to stay running solely to poll on its own clock.

## Requirements

### Requirement: Declared scheduled wakes

The extension SHALL declare schedule entries for routing refresh and quota
probe and MUST accept the host's `POST /schedule` request using the SDK's
schedule contract.

#### Scenario: Host wakes the service

- **WHEN** the host posts a valid schedule run to the service
- **THEN** the service accepts the run and returns a success response

#### Scenario: Unknown schedule version

- **WHEN** the host posts a schedule run with a version the service does not know
- **THEN** the service rejects the run as required by the SDK contract

### Requirement: No always-on polling

The service SHALL NOT keep a process alive solely for its own refresh interval
and MUST refresh on scheduled wakes instead.

#### Scenario: No open project

- **WHEN** a scheduled wake arrives while no project has been named
- **THEN** the service performs no project refresh and still succeeds

#### Scenario: Idle service

- **WHEN** no project has requested the section
- **THEN** no periodic refresh timer runs for routing or quota

### Requirement: Existing freshness behavior preserved

Scheduled wakes SHALL honor the existing per-project refresh throttle and the
immediate refresh triggered by the router switch.

#### Scenario: Throttled wake

- **WHEN** a scheduled wake arrives within the throttle window
- **THEN** no extra routing refresh is performed

#### Scenario: Switch toggle

- **WHEN** the user turns router sync back on
- **THEN** the refresh happens immediately regardless of the throttle
