# Proposal

## Why

The canary shows extension usage in the Work Status headline. The modelselect extension already reports OpenCode Go / Console usage through its quota provider, but that data only appears in the Usage page, not in the Work Status headline where users look first.

## What Changes

- Surface the extension's quota windows in the Work Status headline.
- Reuse the existing `usage-limits.json` snapshot instead of fetching again.
- Keep the headline within the host's row budget.

## Minimum OpenChamber SDK version

- Stable: OpenChamber `>=2.8.0` (released 2026-11-22).

## Capabilities

### New Capabilities

- `extension-usage-headline`: extension quota appears in the Work Status headline.

### Modified Capabilities

- `tracker-connection-for-quota`: quota data feeds the headline.

## Impact

- `openchamber-modelselect/service/src/view.js`, `service/src/main.js`.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Adding new quota providers.