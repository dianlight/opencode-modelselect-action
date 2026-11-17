# Proposal

## Why

OpenChamber 2.7.3 keeps a per-surface setting hidden from other surfaces. The modelselect plugin stores options inside the OpenCode config, so a setting changed on one surface leaks to others and requires a reload; `options-out-of-opencode-config` already wants options out of config.

## What Changes

- Move plugin options to the host's per-surface settings store instead of the OpenCode config entry.
- Let each surface (desktop/web/VS Code) keep its own value where appropriate.
- Drop the config-rewrite workaround once the store is authoritative.

## Out of Scope

- Migrating historical config values automatically (manual migration note only).
- Changing option semantics.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — settings storage change.)

### Modified Capabilities

- `plugin-options`: per-surface storage.

## Impact

- `openchamber-modelselect` service/panel, plugin, tests.