# Spec Delta

## Purpose

Defines that sessions an agent owns as workers (`session.parentId` set) are
excluded from the extension's own evidence, counts and marks, so agent-internal
work neither proves hosting nor inflates the surfaces the user sees.

## ADDED Requirements

### Requirement: Worker sessions are not evidence

The service SHALL skip sessions with `parentId !== null` when stamping host
evidence.

#### Scenario: Dispatched worker archived
- **WHEN** a worker session is archived
- **THEN** the evidence map loses no entry it did not have

### Requirement: Worker sessions are not counted

The service SHALL skip sessions with `parentId !== null` when counting pending
requests.

#### Scenario: Worker waits on a form
- **WHEN** a worker session has an open question
- **THEN** the pending count does not include it

### Requirement: Worker rows are not marked

The service SHALL NOT call `host.setMark` for a session with `parentId !== null`.

#### Scenario: Worker runs a routed turn
- **WHEN** a worker session finishes a routed turn
- **THEN** no mark is set on its row
