# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 lets a session lead agree models with the user before handing out work. The plugin still infers delegated models from prompt text and ACK words, which misroutes work and spends tokens on annotations.

## What Changes

- Require an explicit model agreement from the lead before any subagent dispatch, surfaced through the modelselect action or agent page.
- Stop using prompt ACK-word and regex heuristics in `plugin/src/shared/detect.js` to infer a delegated model.
- Remove the in-prompt `[modelselect: …]` annotation on delegated turns.

## Out of Scope

- Auto-dispatching work without user involvement.
- Changing stateless Small Model picks.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `lead-model-agreement`: defines how a session lead agrees a model with the user before delegating work to subagents.

### Modified Capabilities

(none)

## Impact

- `plugin/src/shared/detect.js`
- `plugin/src/v2.js`
- `plugin/src/shared/select.js`
- plugin sim scenarios
