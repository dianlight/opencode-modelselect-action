# Proposal

## Why

OpenCode 2.4.0 reloads config only when a config feed changes. The service still POSTs defensive reloads after tier changes, plugin saves and plugin-add actions.

## What Changes

- Stop issuing reloads when the routing write does not change a config feed.
- Keep a reload only for writes that alter a watched config feed.
- Avoid unchanged guest-instruction rewrites as part of the same path.

## Out of Scope

- Changing host config watch behavior.
- Removing plugin setup actions.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `config-reload-routing-writes`: defines config-reload behavior for routing writes.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`
- `plugin/src/v2.js`
- `openspec/changes/skip-unchanged-guest-instructions-write/proposal.md`
