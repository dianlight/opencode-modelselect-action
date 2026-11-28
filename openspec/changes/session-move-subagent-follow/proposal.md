# Proposal

## Why

OpenCode 2.4.2 moves subagents when a session is moved. The extension keys routing and status cache files by session id and project path, so a moved session can leave stale status files behind.

## What Changes

- Update routing and status cache locations when a session moves.
- Carry subagent routing state with the parent session.
- Leave no stale status row at the previous location.

## Out of Scope

- Changing the host session-move command.
- Changing model selection logic.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `session-move-cache-follow`: defines how routing and status caches follow a session that moves with its subagents.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/view.js`
- `plugin/src/shared/core/routing.js`
- `openchamber-modelselect/service/src/main.js`
