# Proposal

## Why

OpenChamber 2.7.1 adds `inWork` (sidebar In work membership) and `unread`
(unread turn mark) to session records. The extension could use these to
prioritize routing hints and to avoid surfacing stale sessions, but currently
ignores them.

## What Changes

- Read `inWork` and `unread` from session records in the service.
- Adjust the session action summary to mark unread sessions and skip in-work
  gating where appropriate.
- Keep behavior unchanged on hosts that omit the fields.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `session-activity-flags`: how inWork/unread affect the extension views.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- Depends on `sdk-bump-to-canary-20261112`.
