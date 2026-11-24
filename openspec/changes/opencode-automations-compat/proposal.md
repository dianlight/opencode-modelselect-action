# Proposal

## Why

OpenCode 2.4.0 introduces a formal Automations system: agents can schedule prompts,
scripts or shell commands on a timer, cron schedule or when an MCP server sends an
event. The modelselect extension currently implements its own polling loop
(`modelselect-automation-schedule`) and timer-based waits
(`modelselect-quota-wait`, `2026-11-24-script-waits-for-modelselect`), which cost
model turns and lag behind events. The host now drives these checks natively.

## What Changes

- Adopt OpenCode 2.4.0 Automations for the scheduled routing sync and quota probe,
  replacing the extension's `setInterval` and `keepRunning` polling.
- Set `"automations": false` in opencode.json to disable the host automations when
  the user prefers the extension's own timers.
- Update the extension to stop its `setInterval`-based maintain loop when the host
  provides automations.
- Verify behavior parity between the extension's polling and host automations.

## Out of Scope

- Migrating existing automation files from the extension's polling system.
- Changes to routing or quota logic themselves.
- Adding new automation sources beyond OpenCode's built-in three (timer, cron, MCP event).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `opencode-automations-compat`: adopts the host Automations system instead of extension polling.

### Modified Capabilities

- `modelselect-automation-schedule`: routing sync and quota probe move to host automations.

## Impact

- `openchamber-modelselect/service/src/main.js` — remove the `setInterval` maintain loop.
- Tests under `openchamber-modelselect/test/`.

## Safe to Revert

Set `"automations": false` in opencode.json to fall back to the extension's timers.
