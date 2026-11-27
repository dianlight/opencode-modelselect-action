# Proposal

## Why

The canary lets users hide and reorder individual pages in the Pages section. The modelselect extension contributes panel pages and status surfaces that may not be relevant to every user, and currently cannot be hidden or reordered without uninstalling.

## What Changes

- Allow the modelselect pages to be hidden or reordered in the Pages section.
- Persist the user's page order in the extension config.
- Keep required pages (status section) visible by default.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `pages-hide-reorder`: modelselect pages can be hidden and reordered.

### Modified Capabilities

- `mobile-panel-for-modelselect`: panel pages follow the new ordering.

## Impact

- `openchamber-modelselect/package.json` manifest.
- `openchamber-modelselect/service/src/store.js` (extension config).

## Out of Scope

- Reordering host pages outside the extension.