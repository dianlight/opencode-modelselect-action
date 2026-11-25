# Proposal

## Why

OpenCode 2.4.0 introduces a formal Automations system, and the
`modelselect-automation-schedule` change has now moved routing refresh and the
quota probe off the extension's own clock: the service accepts host-driven
`POST /schedule` wakes, and the `setInterval` loop and `keepRunning` are gone.
What is missing is a recorded verdict that the extension still behaves the same
on this host-driven path.

## What Changes

- Verify the host-driven `routing-refresh` and `quota-probe` wakes against the
  SDK schedule contract on the OpenCode 2.4.0 / OpenChamber `>=2.8.0` profile.
- Verify parity with the retired polling behavior: the 30 s per-project
  throttle, the immediate refresh on a router-switch toggle, and a wake with no
  open project.
- Document that host automations are now the only scheduler: setting
  `"automations": false` in `opencode.json` disables scheduled refresh and
  leaves no extension-side timer to fall back to.
- Record the compatibility verdict in the extension README.

## Out of Scope

- Reintroducing the `setInterval` loop, `keepRunning`, or any extension-side
  fallback timer.
- Migrating existing automation files or adding automation sources beyond the
  host's three built-ins (timer, cron, MCP event).
- Changing routing or quota computation.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `opencode-automations-compat`: records that host automations replace extension polling.

### Modified Capabilities

- `modelselect-automation-schedule`: verified against OpenCode 2.4.0; no polling fallback remains.

## Impact

- `openchamber-modelselect/README.md` — document the host-automations-only scheduler.
- Tests and sim scenarios under `openchamber-modelselect/test/` and
  `sim/scenarios/service/`.

## Safe to Revert

There is no extension-side rollback switch. Disabling host automations stops
scheduled refresh entirely; restoring polling means reverting
`modelselect-automation-schedule`.
