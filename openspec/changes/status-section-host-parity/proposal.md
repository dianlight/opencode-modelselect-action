# Proposal

## Why

2.7.0 and 2.7.1 already put the session's plan in Context sources and the session
totals and cache hit in the Work Status panel. `status-section-plan-row` and
`status-section-session-totals` would duplicate host data, and every added row
spends the section's 16-row budget — the reason `status-section-polish` pins the
auto-update switch last. The modelselect section should carry only what the host
cannot: the routed pick (task, tier, model, Think, Jev reason), quota/sparkline
and sync age.

## What Changes

- Define the modelselect-owned row set and drop the plan and session-total rows
  from the roadmap.
- Keep one compact context row only if it adds routing meaning (model versus
  context limit); otherwise rely on the host.
- Fold the decision into `status-section-polish`'s drop order and row budget.
- Update the schema-validated view, `guestStatusViewSchema` tests and README.

## Out of Scope

- Replacing host Session Totals or Context sources.
- Changing quota data sources.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `status-section`: owned row set and drop order.

## Impact

- `openchamber-modelselect/service/src/view.js`,
  `test/status-service.test.cjs`, README.
- Supersedes `status-section-plan-row` and `status-section-session-totals`.
