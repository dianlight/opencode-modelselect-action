# Proposal

## Why

OpenCode 2.4.2 computes cost estimates from service-tier prices, including long-context rates. The extension stores hard-coded 0–8 cost bounds in `service/src/store.js` and guesses prices from cached catalog data.

## What Changes

- Use host cost estimates that include service-tier and long-context prices.
- Remove local cost bounds and guessed prices from the store.
- Keep the free/paid distinction for routing decisions.

## Out of Scope

- Changing quota numbers.
- Changing which model is selected.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `service-tier-cost-estimates`: defines cost estimates from service-tier prices including long-context rates.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/store.js`
- `openchamber-modelselect/service/src/view.js`
- `plugin/src/shared/core/free-quota.js`
