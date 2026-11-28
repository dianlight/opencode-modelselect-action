# Proposal

## Why

OpenCode 2.4.1 adds `experimental.model_speeds`, exposing service tiers as remembered speeds. The extension currently strips tier/config suffixes in `core/catalog.js` and overlays variants in `plugin/src/v2.js`, maintaining its own tier-suffixed rows.

## What Changes

- Consume `experimental.model_speeds` for known speed tiers.
- Stop synthesizing tier-suffixed picker rows from `VARIANT_SUFFIXES`.
- Keep canonical model ids and thinking variants in the picker.

## Out of Scope

- Changing model scoring or task-type definitions.
- Removing the free/paid variant distinction.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `model-service-tier-speeds`: defines service-tier speeds as remembered host state instead of separate model picker rows.

### Modified Capabilities

(none)

## Impact

- `core/catalog.js`
- `plugin/src/v2.js`
- `plugin/src/shared/core/catalog.js`
- `openchamber-modelselect/panel/src/models-tab.js`
