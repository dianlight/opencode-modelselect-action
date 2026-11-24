# Proposal

## Why

The canary adds terminal tabs in a sheet on portrait phones. Previously, terminal tabs were always horizontal on mobile, which is hard to use on portrait screens. This improves mobile UX for the modelselect extension's terminal interactions.

## What Changes

- Terminal panel detects portrait orientation and switches tabs to a bottom sheet.
- Sheet supports tab switching, renaming, and closing.
- Falls back to horizontal tabs on landscape/desktop.
- No change to terminal behavior, only presentation.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `terminal-tabs-sheet-portrait`: terminal tabs render as a bottom sheet on portrait mobile.

### Modified Capabilities

- `mobile-panel-for-modelselect`: mobile terminal UX parity.

## Impact

- `openchamber-modelselect/panel/src/terminal-tab.js`, `README.md`.
- Depends on `mobile-panel-for-modelselect`.