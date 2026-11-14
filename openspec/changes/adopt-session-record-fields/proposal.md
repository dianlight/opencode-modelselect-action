# Proposal

## Why

2.7.1 session records carry `tool`, `context`, `inWork` and `unread`. Two narrow
proposals read them separately, so the section and the session action would grow
two projections and could disagree with each other and with the host. One
normalized projection, used everywhere, keeps the extension consistent and
avoids re-reading status files per surface.

## What Changes

- Add a `sessionRecord` projection in the service:
  `{ tool, context: { used, limit, pct }, inWork, unread }`, tolerating missing
  fields.
- Use it in the per-session row and the `model-pick` action; keep the existing
  pick fields.
- Prefer the host record when available and fall back to the status file.
- Add tests for old records (no fields), partial records and a full record.

## Out of Scope

- New UI surfaces; no sidebar-mark or command-palette work.
- Host session-record changes.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `status-section`: per-session row fields.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/view.js`, tests.
- Supersedes `surface-session-tool-and-context` and
  `surface-session-inwork-and-unread`.
