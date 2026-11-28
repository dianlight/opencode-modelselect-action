# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 lets a user remove a provider from the config in Settings. Routing caches, quota probes and logos can outlive the provider and keep pointing picks at a configuration that no longer exists.

## What Changes

- React to provider removal and purge that provider's routing entries, cached catalog state and logos.
- Cancel quota probes and in-flight failover attempts targeting the removed provider.
- Fall back to the next valid provider without changing the task's model id.

## Out of Scope

- Removing a model from the model registry.
- Changing the Settings provider editor itself.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `provider-removal-cleanup`: defines how routing state is cleaned up when a user removes a provider from Settings.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`
- `plugin/src/shared/core/routing.js`
- `plugin/src/shared/freequota.js`
- `openchamber-modelselect/panel/src/models-tab.js`
