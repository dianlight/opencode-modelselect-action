# Proposal

## Why

OpenCode 2.3.0 adds an experimental `session.fork` hook for TUI plugins, letting
a plugin fork a session and carry context into the fork. The modelselect TUI
plugin cannot fork a session today, so users cannot branch a pick into a new
session without losing the current context.

## What Changes

- Implement the `session.fork` hook in the modelselect TUI plugin.
- Carry the current pick (task, tier, model) into the forked session.
- Gate on host support; no-op on older hosts.
- Add tests for fork lifecycle and context carry.

## Out of Scope

- Changes to the host fork runtime.
- Plugin auto-update (covered separately).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `tui-session-fork-hook`: modelselect supports TUI session forking.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`, plugin tests.
- TUI plugin manifest and hooks.
