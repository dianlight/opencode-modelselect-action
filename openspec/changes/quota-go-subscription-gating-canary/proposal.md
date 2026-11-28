# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 hides OpenCode Go for accounts without a Go subscription. The service currently reports a fixed `OpenCode Go / Console` label and derives `configured` from any quota window, so non-subscribers see an unusable quota row.

## What Changes

- Gate the Go quota provider on the host's subscription signal.
- Replace the fixed label and window-based `configured` heuristic.
- Keep Zen and other providers visible for the same account.

## Out of Scope

- Billing or subscription changes.
- How quota numbers are computed for subscribed accounts.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `quota-subscription-gating`: defines how OpenCode Go quota is shown only to accounts that have a Go subscription.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`
- `openchamber-modelselect/service/src/view.js`
- `openchamber-modelselect/service/src/chain.js`
- `plugin/src/shared/usage.js`
