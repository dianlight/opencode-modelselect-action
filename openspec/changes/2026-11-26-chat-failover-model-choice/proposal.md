# Proposal

## Why

The daily canary (OpenChamber `2.8.1-canary.20261126.32`) now refuses to move a
chat to a model nobody chose, and failed TUI worker requests now return an
error instead of leaving the caller hanging. The modelselect plugin's failover
path must therefore align with a chat that was never moved behind the user's
back.

## What Changes

- Define failover as movement along the task's ordered candidate list only.
- A failover SHALL NOT relocate a chat whose chooser did not pick the failing
  model.
- Failed routed turns SHALL surface the failure instead of silently retrying
  into an unchosen model.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `provider-model-selection`: task → model resolution gains a failover contract.

## Impact

- `plugin/src/` failover ordering and retry handling.
- `github-action/` fallback-model propagation checks.

## Out of Scope

- Changing the task-type → model ranking itself.
- Host-side failover implementation.
