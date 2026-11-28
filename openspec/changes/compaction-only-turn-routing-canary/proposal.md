# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 runs compaction-only turns without activity or notifications. The plugin still emits routing announcements and Work Status writes for those turns, adding noise the host deliberately suppresses.

## What Changes

- Detect compaction-only turns from host session events instead of prompt text.
- Skip routing announcements and status-file writes on those turns.
- Keep normal turn routing unchanged for user-visible turns.

## Out of Scope

- Turns that contain user-visible output.
- Changing host compaction behavior itself.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `compaction-only-turn-routing`: defines how routing stays silent on compaction-only turns that produce no activity or notifications.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `plugin/src/shared/select.js`
- `openchamber-modelselect/service/src/main.js`
- `openchamber-modelselect/service/src/view.js`
