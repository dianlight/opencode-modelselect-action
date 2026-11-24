# Proposal

## Why

Stable v2.8.0 adds that a custom provider can take its model defaults from a known provider. The modelselect extension's routing relies on provider canonicalization; without it, custom providers have no defaults and manual picks become required.

## What Changes

- Accept host-provided canonical provider mapping for custom providers in the provider model pick surface.
- Use the canonical provider to resolve default model ids and tier preferences.
- Fall back to manual pick when no canonical mapping exists.

## Minimum OpenChamber SDK version

- Stable: OpenChamber `>=2.8.0`.
- Canary: not applicable (stable-only feature).

## Capabilities

### New Capabilities

- `custom-provider-model-defaults`: how custom providers inherit model defaults from a known provider.

### Modified Capabilities

- `provider-model-selection`: variant resolution for custom providers with canonical defaults.
- `modeselect-provider-apikey`: default pick resolution for custom providers.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, tests, README.
- No manifest change.
- No new permission.