# Proposal

## Why

The canary surfaces the session's plan in Context sources ("work-status: show the
session's plan in Context sources"). The modelselect status section has no plan
row, so a plan the agent is following is invisible where the user already looks
for work status.

## What Changes

- Add a `Plan` row to the section showing the session's current plan title/steps
  when one exists, read from the host OpenCode connection.
- Hide the row when no plan is attached; keep it above the pick under the row cap.
- Validate the new row against `guestStatusViewSchema`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `status-section-plan`: when a plan row appears and what it shows.

### Modified Capabilities

- `status-section`: adds the plan row.

## Impact

- `openchamber-modelselect/service/src/view.js`, `main.js`, tests.
- Rebuilt `service/main.js`; no new permission beyond `opencode`.
- Depends on `adopt-opencode-role` and `sdk-bump-to-2-7-1`.
