# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 makes `actions.run` wait until the app is up. The service currently guesses `OPENCODE_PORT`/`PORT`/`4096` and POSTs a forced `/api/location/reload` after config writes.

## What Changes

- Rely on `actions.run` readiness instead of port guessing and forced reloads.
- Remove `reloadPorts()` and its `config-reload` callers from `service/src/main.js`.
- Keep the routing-refresh throttle so a wake inside the window is still a no-op.

## Out of Scope

- Changing how actions are declared in the manifest.
- Removing the service schedule entries.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `app-readiness-for-actions`: defines how extension actions wait for the host application before running.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`
- `openchamber-modelselect/package.json`
- `openchamber-modelselect/panel/src/plugin-tab.js`
