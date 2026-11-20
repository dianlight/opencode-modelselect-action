# Spec Delta

## Purpose

Defines that wait checks are answered from the request body plus live state, so
the service retains no wait state of its own and a restart between checks loses
nothing.

## ADDED Requirements

### Requirement: Checks answer from the body

The service SHALL answer `WAITS_CHECK_PATH` from the request's `state` plus a
live read of the latch or sync state, and MUST NOT persist any wait state.

#### Scenario: Service restarted between checks
- **WHEN** the service restarts after starting a wait
- **THEN** the next check answers correctly from the body alone

#### Scenario: State stays fresh
- **WHEN** a check fires while the latch or sync state changed
- **THEN** the answer carries the current state, not the state at start

### Requirement: No wait state in the data folder

The service's data folder MUST NOT contain wait state; a data-folder wipe leaves
every wait answerable.

#### Scenario: Wipe
- **WHEN** the data folder is removed while a wait runs
- **THEN** the next check still answers with the live state
