# Proposal

## Why

Canary wakes a session as soon as a wait fires (timer, script, extension or pull
request): the wake is now delivered with steer during a running turn instead of
waiting for the turn to end, and the activity probe is gone from both runtimes.
The modelselect extension's wait handling still assumes the old hold behaviour,
so wakes can arrive late and the probe code is dead weight.

## What Changes

- Treat a fired wait as immediately deliverable; drop the assumption that the turn
  must finish first.
- Remove the activity-probe workaround from the service and plugin wait paths.
- Update wait-state handling and tests to the new delivery rule.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `wait-wake-delivery`: modelselect adopts immediate wait wake delivery.

### Modified Capabilities

- `modelselect-waits`: wait delivery no longer waits for turn end.
- `wait-stateless-checks`: stateless checks use immediate delivery.

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- `plugin/src/v2.js` wait references.

## Out of Scope

- Changes to the host wait runtime itself.
