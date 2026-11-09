# Proposal

## Why

The Work Status section reports routing and quota but nothing about turns that
are blocked waiting for the user. With richer session events now carrying
permission and form content, and the service able to answer them (see
`adopt-session-control-answers`), the section can show how many requests are
pending and let the user clear them without opening the chat. That removes a
round trip and makes a stalled agent visible where the user already looks.

## What Changes

- Subscribe to `permission-asked` and `question-asked` session events and keep
  a per-project count of pending requests in the service's data folder (see
  `adopt-service-data-dir`).
- Add a `pending` row to the section with the count and, when the service is
  allowed to answer, a control that answers or dismisses the request.
- Drop the count first under the 16-row cap, after notes and budget models, so
  the pick and quota are never pushed off screen.
- Clear a pending entry when the request settles (answered in the app, on
  another device, or by the service) and on `turn-finished`/`turn-failed`.
- Validate the new row against `guestStatusViewSchema` in the service tests.

## Capabilities

### New Capabilities

- `status-section-pending`: how pending requests are counted, shown and
  cleared, and their priority under the row cap.

### Modified Capabilities

- `status-section`: adds the pending row and its drop position.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/view.js`, tests.
- `openchamber-modelselect/package.json` (`contributes.sessionEvents`).
- Rebuilt `service/main.js`; no new permission beyond `transcript` and
  `sessionAnswers`.
- Depends on `adopt-session-control-answers` and `adopt-service-data-dir`.