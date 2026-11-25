# Proposal

## Why

OpenCode 2.4.0 measures session throughput from the first streamed token instead
of the full response. The modelselect extension displays session metrics (Work
Status, cumulative tokens) using throughput values that now start earlier,
causing mismatched or stale throughput figures.

## What Changes

- Update session metric calculations to use first-token-based throughput.
- Refresh Work Status and cumulative-tokens displays on first-token events.
- Add tests for throughput from first token.

## Out of Scope

- Changing the throughput calculation itself.
- Adding new metric types.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `session-throughput-first-token`: modelselect uses first-token throughput.

### Modified Capabilities

- `session-cumulative-tokens`: throughput field updated.

## Impact

- `openchamber-modelselect/service/src/view.js`, `service/src/main.js`, tests.
- Work Status metric display.
