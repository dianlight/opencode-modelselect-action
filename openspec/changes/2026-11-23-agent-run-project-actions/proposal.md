# Proposal

## Why

The canary lets agents run a project's actions. The modelselect extension contributes a `model-pick` session action that is currently only reachable through the UI, so agents cannot trigger a model pick or inspect its result during a run.

## What Changes

- Expose the extension's session action to agents as a runnable project action.
- Return the pick summary (task, tier, model, think) as the action result.
- Guard the action so it only runs inside a project with a known pick.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `agent-run-project-actions`: agents can invoke the modelselect pick action.

### Modified Capabilities

- `expanded-session-action-view`: action becomes agent-runnable.

## Impact

- `openchamber-modelselect/service/src/main.js`, `panel/src/main.js`.
- Manifest action definition in `package.json`.

## Out of Scope

- Letting agents change plugin options or tier without user confirmation.