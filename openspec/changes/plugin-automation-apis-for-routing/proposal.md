# Proposal

## Why

OpenCode 2.4.1 adds `ctx.experimental.automation.create/list/delete`. Routing refresh currently depends only on manifest cron entries and a local 30-second throttle in the service.

## What Changes

- Let the plugin create, list and delete routing automations through the experimental automation API.
- Keep manifest cron entries for hosts without the API.
- Preserve the existing throttle and immediate-on-toggle behavior.

## Out of Scope

- Changing the schedule contract itself.
- Removing the service schedule entries.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `plugin-routing-automations`: defines plugin-managed routing automations alongside manifest schedule entries.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `openchamber-modelselect/package.json`
- `openchamber-modelselect/service/src/main.js`
- `opencode-automations-compat`
