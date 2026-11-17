# Proposal

## Why

The canary nests an agent's own worker sessions under it: `session.parentId` is
set, the secret card stays out of worker sessions, and a dispatched session's
answer arrives on its own idle. `GET /api/session` and `session-archived` events
now carry those workers, so the host-evidence map and the pending-request count
can double-count work the agent already owns, and marks can land on rows the user
cannot open. `parentId` is already in the 2.7.2 SDK, so the filter is
implementable today.

## What Changes

- Skip `parentId !== null` sessions when stamping host evidence and counting
  pending requests.
- Keep worker sessions out of sidebar marks; nest them visually only where the
  host already does.
- Test with a worker event stream: evidence, count and marks unchanged by worker
  churn.

## Out of Scope

- Host nesting UI and dispatched-answer delivery.
- Changes to the session-record projection itself.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.2` (`parentId` is in the 2.7.2 SDK).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `host-detection`: worker sessions are not evidence.
- `status-section-pending`: worker sessions are not counted.
- `sidebar-marks`: worker rows are not marked.

## Impact

- `openchamber-modelselect/service/src/main.js`, `core/host-evidence.js`, tests.
- Coordinates with `adopt-session-record-fields` and `status-section-pending-requests`.
