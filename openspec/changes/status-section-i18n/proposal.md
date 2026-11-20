# Proposal

## Why

The host already sends `?locale=` to the status section's `GET /status`, but the
view builder ignores it: every label, tooltip, badge and note in
`service/src/view.js` is hardcoded English. Users on a localized OpenChamber see
an English Work Status section next to a localized host.

## What Changes

- Thread the host-supplied locale into the view snapshot and select a message
  table for it, with English as the fallback for unknown or missing locales.
- Localize the fixed labels, tooltips, badges and note text (task, tier, model,
  think, age, quota, budget, latch notices, router switch and empty states),
  while leaving data values such as model ids and task names untouched.
- Keep every schema limit, row id and control id stable across locales and add
  tests for a supported locale, an unsupported locale and a missing locale.

## Out of Scope

- Translating the settings panel or the session action toast.
- Adding a new localization dependency or translating data values.
- Changing which rows exist or how quota is computed.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `status-section-localization`: how the host-rendered status section chooses
  its display language and falls back when a locale is unavailable.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/view.js`, `service/src/main.js`,
  `test/status-view.test.cjs`, `test/status-service.test.cjs`, README.
