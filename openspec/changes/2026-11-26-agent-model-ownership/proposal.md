# Proposal

## Why

The daily canary (OpenChamber `2.8.1-canary.20261126.32`, built on OpenCode
`2.4.2`) now keeps an agent with its own model when the user switches to it
mid-session. Combined with the stable `2.8.0` session-default surface, task-first
routing needs an explicit agent-scoped model layer instead of a single task →
model id mapping.

## What Changes

- Add an agent-owned model scope to task → model resolution: an agent override
  wins for the sessions created for that agent and survives an agent switch.
- Fall back to task-type routing for agents without an override.
- Report the effective agent model in the Work Status pick row.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `agent-model-ownership`: an agent keeps its own model across switches.

### Modified Capabilities

- `provider-model-selection`: task → model resolution gains an agent override layer.

## Impact

- `plugin/src/` routing resolution and failover ordering.
- `openchamber-modelselect/service/src/view.js` pick row rendering.

## Out of Scope

- Free/paid variant remapping per agent.
- Host-side agent model storage.
