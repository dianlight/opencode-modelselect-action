# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 summarizes activity in a few fixed words and lets a running fold close. Work Status currently shows routing detail lines that do not fold and can outlive the turn.

## What Changes

- Summarize pick, failover and quota activity in a fixed number of words.
- Close the running fold when the host closes it instead of leaving a stale row.
- Keep the full detail available behind the summary.

## Out of Scope

- Changing host grouping of tool calls.
- Removing the status section itself.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `activity-summary-lifecycle`: defines fixed-word activity summaries and the lifecycle of a running fold.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/view.js`
- `openchamber-modelselect/panel/src/status-tab.js`
- `openchamber-modelselect/service/src/main.js`
