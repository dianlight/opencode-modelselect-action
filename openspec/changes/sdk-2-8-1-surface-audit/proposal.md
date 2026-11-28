# Proposal

## Why

The active `sdk-surface-audit-2-7-3` change targets a stale SDK baseline. OpenChamber 2.8.1 is now the stable floor and bundles OpenCode 2.4.2, so a fresh audit is needed to retire workarounds that the stable surface already removes.

## What Changes

- Audit the `@openchamber/sdk` 2.8.1 surface used by the extension and plugin.
- Update minimum versions and remove workarounds that 2.8.1 makes unnecessary.
- Supersede `sdk-surface-audit-2-7-3` without changing unrelated routing specs.

## Out of Scope

- Adopting the 2.8.2 canary features.
- Changing the model scoring pipeline.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `sdk-surface-parity`: defines how the extension tracks the stable 2.8.1 SDK surface.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`
- `openspec/changes/sdk-surface-audit-2-7-3/proposal.md`
- extension README
- sim scenarios
