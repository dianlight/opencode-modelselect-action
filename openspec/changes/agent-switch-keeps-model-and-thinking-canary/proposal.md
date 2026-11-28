# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 keeps the model and thinking level when switching agents. The plugin currently re-derives both on agent switches, so a manual pick is lost and a fresh routing annotation is injected.

## What Changes

- Keep the session model and thinking variant across agent switches instead of recomputing them.
- Stop emitting a new routing annotation on an agent switch that does not change the model.
- Extend the `2026-11-26-agent-model-ownership` behavior to cover the switch path without obsoleting it.

## Out of Scope

- Changing the model when the user explicitly picks a new one.
- Changing how agent instructions are authored.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `agent-switch-model-continuity`: defines how a chat preserves its model and thinking level when the user switches agents.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `plugin/src/shared/select.js`
- `plugin/src/shared/detect.js`
- plugin sim scenarios
