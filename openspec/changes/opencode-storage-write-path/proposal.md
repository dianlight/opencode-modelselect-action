# Proposal

## Why

OpenCode 2.4.0 changes the storage write path: assistant parts are now saved as
their own rows in the database, and `experimental.part_rows: false` restores the
old path for backward compatibility. This affects the plugin and extension, which
read and write session data through OpenCode's storage layer.

## What Changes

- Adopt the new storage write path (assistant parts as own rows) by default.
- Set `experimental.part_rows: false` in the extension's managed config only if
  backward compatibility is needed for other tooling.
- Verify the extension's session reads work with both write paths.

## Out of Scope

- Modifying OpenCode's storage engine.
- Changing the extension's data model for its own session records.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `opencode-storage-write-path`: adopt the assistant parts as own rows storage write path.

## Impact

- `plugin/src/v2.js`, `openchamber-modelselect/service/src/`.

## Safe to Revert

Set `experimental.part_rows: false` in the extension config.
