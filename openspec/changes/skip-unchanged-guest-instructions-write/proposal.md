# Proposal

## Why

OpenChamber 2.7.3 skips writing the guest instructions file when nothing changed. The modelselect plugin rewrites routing context into AGENTS.md on every sync, even when unchanged, which is wasteful and races with user edits.

## What Changes

- Rely on the host's skip-unchanged behavior for instruction writes.
- Remove the plugin's own redundant write/diff logic where it duplicates the host.
- Add a test asserting no write occurs when routing context is unchanged.

## Out of Scope

- Changing what routing context is written.
- Touching non-instruction files.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — optimization.)

### Modified Capabilities

(none)

## Impact

- `plugin/` routing injection code, tests.