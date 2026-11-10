# Proposal

## Why

Host detection currently relies on a session-map file written by the service and
read by the plugin, with a synthetic `openchamber` key before the first routed
turn. OpenChamber 2.7.1 exposes connection events (`ready.connection`,
`host.onConnection`) that can replace this polling/file workaround.

## What Changes

- Subscribe to connection events in the service.
- Stamp the session map from connection events instead of status reads.
- Remove the synthetic-key workaround once connection events are reliable.
- Keep the 30-day prune.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `connection-driven-detection`: event-based host detection.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, store, tests.
- Depends on `sdk-bump-to-canary-20261110`.
- Supersedes the polling approach in `event-driven-host-detection`.
