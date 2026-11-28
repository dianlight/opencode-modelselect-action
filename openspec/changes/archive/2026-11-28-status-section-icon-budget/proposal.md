# Proposal

## Why

SDK `2.7.2` added an `icon` field on status line rows and a top-level `controls`
array, but the extension uses neither. Every fixed row is a plain text line and
the only control, `Auto-update router`, consumes one of the hard-capped 16 rows
via an inline segmented content, leaving less room for budget and latch rows.

## What Changes

- Give the fixed status rows Remixicon-compatible `icon` names so each row is
  recognizable at a glance, subject to the SDK's icon-name pattern.
- Move the `Auto-update router` switch out of the row list into the view's
  `controls` header as an On/Off select with the same `routing-sync` control id
  and `on`/`off` values, so the existing control handler keeps working.
- Reclaim the freed row for budget or latch rows and add schema tests for icons,
  the header control, unique control ids and the row cap.

## Out of Scope

- Localizing the labels (`status-section-i18n` owns that).
- Adding a new icon font or changing the host renderer.
- Changing quota computation or the router-sync file format.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `status-section-row-budget`: how the status section spends its row cap and
  exposes controls in the header.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/view.js`,
  `test/status-view.test.cjs`, `test/status-service.test.cjs`, README.
