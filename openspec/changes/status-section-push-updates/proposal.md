# Proposal

## Why

The status section polls the service every 2s. OpenChamber 2.7.1 connection
events allow push updates, removing the polling workaround and reducing load.

## What Changes

- Switch the status section source from polling to push via connection events.
- Keep a fallback poll for older hosts.
- Ensure rows still update within the 16-row cap.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `status-section-push`: push-based status updates.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, manifest, tests.
- Depends on `sdk-bump-to-canary-20261110`.
