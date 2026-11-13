# Proposal

## Why

The service keeps routing sync fresh on its own clock via `keepRunning`. OpenChamber
2.7.1 adds `service.schedule` to wake a service on a clock at `POST /schedule`.
Using it would remove the always-on polling workaround and let the host drive
cadence.

## What Changes

- Add `service.schedule` to the manifest.
- Implement `POST /schedule` parsing via `readServiceScheduleRequest`.
- Keep the 30s throttle and immediate-on-toggle behavior.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `scheduled-routing-sync`: wake cadence and throttle.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, service main, tests.
- Depends on `sdk-bump-to-canary-20261113`.
