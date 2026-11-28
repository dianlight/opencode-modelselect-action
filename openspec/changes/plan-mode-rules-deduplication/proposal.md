# Proposal

## Why

OpenCode 2.4.2 keeps plan-mode rules in the system prompt and does not re-add them on compaction. The plugin appends its own routing hints to prompts, which can duplicate those rules after a compaction.

## What Changes

- Detect plan-mode rules supplied by the host and skip duplicate routing hints.
- Do not re-emit hints after compaction when the host already carries them.
- Keep a hint when the host supplies no plan-mode rules.

## Out of Scope

- Changing plan-mode behavior itself.
- Removing routing hints outside plan mode.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `plan-mode-routing-hints`: defines deduplication of routing hints in plan mode.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `plugin/src/shared/select.js`
- `openspec/changes/routing-context-token-budget/proposal.md`
