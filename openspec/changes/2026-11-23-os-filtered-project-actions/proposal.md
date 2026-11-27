# Proposal

## Why

The canary hides actions meant for an OS other than the server's. The modelselect extension contributes a session action and panel entries that can run on a server whose OS differs from the client, so actions that only make sense on one OS currently show up everywhere and fail at runtime.

## What Changes

- Declare a supported-OS list on each contributed action.
- Hide actions whose OS does not match the server's in the panel and command palette.
- Keep the model-pick action visible on all OSes (it is OS-agnostic).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `os-filtered-project-actions`: actions are filtered by server OS.

### Modified Capabilities

- `expanded-session-action-view`: action visibility respects server OS.

## Impact

- `openchamber-modelselect/package.json` manifest actions.
- `openchamber-modelselect/panel/src/main.js`.

## Out of Scope

- Filtering by client OS or browser.