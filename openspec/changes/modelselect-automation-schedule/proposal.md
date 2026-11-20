# Proposal

## Why

The service currently declares `keepRunning: true` and refreshes routing and
quota from an always-on 60-second `setInterval`. SDK `2.7.2` supports
`contributes.service.schedule` with host-driven cron wakes at `POST /schedule`,
and OpenCode `2.3.1` generalizes scheduled agent work through its `automations`
flag. Keeping a process alive just to poll wastes resources on idle projects.

## What Changes

- Declare a small set of `service.schedule` cron entries for routing refresh
  and quota probe, and implement `POST /schedule` with the SDK's schedule
  request parser and version check.
- Remove the `keepRunning` interval, keeping the existing per-project 30-second
  throttle and immediate refresh when the user toggles the router switch.
- Verify the OpenCode `2.3.1` `automations` path for plugin-side probes and stop
  the scheduled refresh while no project is open.

## Out of Scope

- Changing what routing sync or quota probing computes.
- The status section UI or the header control.
- Adding new cron entries beyond refresh and probe.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `service-schedule-refresh`: how host-scheduled wakes keep routing and quota
  fresh without an always-on service.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `service/src/main.js`,
  `test/status-service.test.cjs`, sim harness, extension README.
- Supersedes the polling part of `scheduled-routing-sync`.
