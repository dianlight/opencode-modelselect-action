# Proposal

## Why

OpenChamber 2.7.0 adds a Session Totals card to the Context panel (input, output,
reasoning, cache reads/writes, cache hit rate) and shows the last reply's cache
hit in Work Status. The modelselect status section shows quota but not the session's
own token totals, so the two surfaces disagree about what a turn cost.

## What Changes

- Add a `Usage`/totals row to the section showing the session's input, output,
  reasoning and cache numbers plus the cache hit rate, read from the host OpenCode
  connection.
- Drop it under the 16-row cap after notes and budget models, before the pick.
- Validate the new row against `guestStatusViewSchema` in the service tests.

## Capabilities

### New Capabilities

- `status-section-session-totals`: what the totals row shows and its drop position.

### Modified Capabilities

- `status-section`: adds the totals row.

## Impact

- `openchamber-modelselect/service/src/view.js`, `main.js`, tests.
- Rebuilt `service/main.js`; no new permission beyond `opencode`.
- Depends on `adopt-opencode-role` and `sdk-bump-to-2-7-1`.
