# Proposal

## Why

OpenCode 2.4.2 moves tool definitions into Code Mode, so every extra prompt token competes with tool schemas. The plugin appends a `[modelselect: …]` annotation of roughly 15 tokens to each prompt and persists it in the chat.

## What Changes

- Replace per-turn annotations with keyed session instructions that can be updated without repetition.
- Define a token budget for routing hints and skip unchanged writes.
- Keep fallback and failover visibility in Work Status instead of the prompt.

## Out of Scope

- Removing routing visibility entirely.
- Changing host Code Mode behavior.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `routing-instruction-budget`: defines a bounded, keyed instruction budget for routing hints.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `plugin/src/shared/select.js`
- `openspec/changes/skip-unchanged-guest-instructions-write/proposal.md`
