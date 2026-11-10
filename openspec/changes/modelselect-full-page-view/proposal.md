# Proposal

## Why

OpenChamber 2.7.1 allows a page with its own `entry` without `panel.entry`,
so an extension can ship a full-screen page without a rail panel. The extension
currently requires a panel for all views; a page-only distribution would suit
users who only want the modelselect dashboard.

## What Changes

- Add `contributes.page` with its own entry pointing at a new page bundle.
- Reuse the existing panel rendering in page mode.
- Keep `panel.entry` for the rail icon and status section consumers.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `modelselect-page-view`: page-only entry and its lifecycle.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, new page bundle, build scripts.
- Depends on `sdk-bump-to-canary-20261110`.
