# Proposal

## Why

OpenChamber 2.7.3 tells the agent which project actions are running. The modelselect extension registers a background session action (`model-pick`) but its running state is invisible to the agent and to the Work Status section, so a long-running pick looks idle.

## What Changes

- Surface the `model-pick` action's running/idle state in the Work Status section.
- Let the agent read whether a model pick is in flight before starting another.
- Fold the new state into `status-section-pending-requests` rather than a separate row.

## Out of Scope

- Changing the pick execution model.
- Adding new session actions.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — surfaces existing action state.)

### Modified Capabilities

- `status-section`: add running-action indicator.

## Impact

- `openchamber-modelselect/service` view/main, tests.