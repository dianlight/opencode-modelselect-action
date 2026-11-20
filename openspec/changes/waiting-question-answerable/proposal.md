# Proposal

## Why

OpenChamber 2.7.3 keeps a waiting question (form or page) answerable when the
user sends a message: sending no longer closes it, and the agent keeps waiting
for the answer. The modelselect service answers `question-asked` events on the
user's behalf and the `status-section-pending-requests` row counts them, so a
send that silently closed the question made a pending request disappear and
left the count stale. The host fix removes that race.

## What Changes

- Rely on the host's keep-answerable behavior: the service no longer needs to
  resend or re-post a closed question, and the pending count stays consistent.
- Drop any workaround in the answers path that re-asserts a question after a
  send.
- Add a test asserting a pending request survives a user send.

## Out of Scope

- Answering pages (still sent to the session).
- Changing answer values.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.3`.

## Capabilities

### New Capabilities

(none — relies on a host behavior change.)

### Modified Capabilities

- `session-control-answers`, `status-section-pending`: pending count stays
  consistent across a user send.

## Impact

- `openchamber-modelselect/service/src/main.js` (answers path), tests.
- Rebuilt `service/main.js`.
