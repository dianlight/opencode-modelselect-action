# Spec Delta

## Purpose

Lets the modelselect service read what the OpenChamber-hosted OpenCode actually
reports — sessions, messages, projects and live events — through the approved
`opencode` role, instead of inferring that state from cache files it does not
own.

## ADDED Requirements

### Requirement: Connection comes only from the host

The service SHALL reach OpenCode only through `OPENCHAMBER_OPENCODE_URL` and
authenticate only with `OPENCHAMBER_SERVICE_TOKEN`.

#### Scenario: Approved role present
- **WHEN** the service starts with both variables set
- **THEN** every read uses that base URL with `Authorization: Bearer` and no other origin

#### Scenario: Variables absent
- **WHEN** either variable is missing
- **THEN** the service makes no request and marks the reading as file-derived

#### Scenario: No discovery
- **WHEN** the connection is unavailable
- **THEN** the service does not scan ports, read OpenCode's data directory, or start a server as a fallback

### Requirement: Only listed reads are used

The service SHALL use only `GET /api/session`, `GET /api/session/active`,
`GET /api/session/<id>`, `GET /api/session/<id>/message`, `GET /api/project`
and `GET /api/event`, and MUST NOT attempt any write, prompt, configuration or
plugin route.

#### Scenario: A refused read
- **WHEN** OpenCode or the host answers 403 or another error
- **THEN** the service keeps its last known values, marks them stale, and never substitutes an empty success

### Requirement: Event-driven freshness

While the section or the panel is shown, the service SHALL keep one event
stream open and answer `/status` from the snapshot it maintains.

#### Scenario: A streaming turn
- **WHEN** a session event arrives
- **THEN** the snapshot is updated without re-reading the project directory or its status files

#### Scenario: Stream ends
- **WHEN** the stream closes or exceeds the response byte cap
- **THEN** the service reconnects with backoff, keeps the snapshot, and marks the age of the last update

### Requirement: Session truth beats file inference

When the role is granted, the service SHALL report the session list and
activity from OpenCode and use `status-*.json` only for the routed pick.

#### Scenario: A session that never routed
- **WHEN** OpenCode lists a session with no status file
- **THEN** the session is still recognized as present and not shown as routed

#### Scenario: Degraded host
- **WHEN** the role is not granted
- **THEN** the reading is built from the files exactly as before, with no functional loss

### Requirement: The token never leaves the service

The service MUST NOT expose the OpenCode URL or token to the panel, the status
answer, an error message, or a log line, and MUST NOT log message content.

#### Scenario: A failed connection
- **WHEN** a request fails
- **THEN** the reported error names the operation and status only, with no URL and no token
