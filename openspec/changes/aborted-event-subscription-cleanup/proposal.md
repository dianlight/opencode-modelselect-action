# Proposal

## Why

OpenCode 2.4.1 stops a shared event subscription immediately on abort. The plugin keeps status-push and quota subscription fallback timers and retry TTLs that can continue after an abort.

## What Changes

- Remove subscription retry timers that outlive an aborted event stream.
- Use the host's immediate abort signal for status and quota subscriptions.
- Keep reconnection for genuinely dropped connections.

## Out of Scope

- Changing quota computation.
- Changing how status is rendered.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `aborted-subscription-cleanup`: defines immediate cleanup when a shared event subscription is aborted.

### Modified Capabilities

(none)

## Impact

- `plugin/src/shared/usage.js`
- `plugin/src/v2.js`
- `openchamber-modelselect/service/src/main.js`
