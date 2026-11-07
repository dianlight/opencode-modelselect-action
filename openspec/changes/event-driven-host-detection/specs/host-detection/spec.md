# Spec Delta

## Purpose

Defines the evidence that tells the plugin it is running inside OpenChamber,
how fresh that evidence must be, and how it is kept free of sessions that no
longer exist.

## ADDED Requirements

### Requirement: A heartbeat proves the extension runs

The extension SHALL write a heartbeat timestamp to the project's evidence file
while it is answering for that project, and evidence older than ten minutes
SHALL NOT count.

#### Scenario: Extension open
- **WHEN** the Work Status section or the panel is open for a project
- **THEN** the heartbeat is refreshed at least every minute

#### Scenario: Extension removed
- **WHEN** the extension stops writing for more than ten minutes
- **THEN** the plugin reports standalone again without any file deletion

#### Scenario: Extension installed, no turn yet
- **WHEN** the project has no routed session
- **THEN** the fresh heartbeat alone is enough to detect OpenChamber

### Requirement: Only real sessions are recorded

The evidence file MUST NOT contain synthetic keys; every entry SHALL name a
session that OpenCode or a status file reported.

#### Scenario: Map contents
- **WHEN** the file holds a heartbeat and sessions
- **THEN** each session id was observed for that project and no placeholder id exists

### Requirement: Archived sessions leave at once

The extension SHALL remove a session's entry when its archive is announced.

#### Scenario: Archive event
- **WHEN** a `session-archived` event arrives for a stamped session
- **THEN** that entry is removed on the next write and the heartbeat is kept

#### Scenario: Archive while the section is closed
- **WHEN** no answer is being served
- **THEN** the removal happens on the first maintenance pass after it, within one minute of the extension being asked again

### Requirement: One contract, two clients

The file's shape, version and lifetime SHALL be defined once and shared by the
writer and the reader.

#### Scenario: Version skew
- **WHEN** the plugin meets a version 1 file
- **THEN** it reads it with the old rules until the extension writes version 2
- **AND** a version it does not know is treated as no evidence

#### Scenario: Constant drift
- **WHEN** either side changes the lifetime
- **THEN** the shared test fails and both consumers are regenerated

### Requirement: Degraded mode changes no behavior

Without the `opencode` role the extension SHALL keep stamping session ids from
the project's status files.

#### Scenario: Older host
- **WHEN** the session listing is unavailable
- **THEN** the evidence is derived from status files and the heartbeat still applies
