# Proposal

## Why

Canary makes Copilot, Z.ai and Zhipu credit windows send `credits: { used, limit }`
so the number follows the used/remaining display mode, and compacts counts (1K, 20K)
in the Work Status headline. The modelselect quota provider still sends a fixed
label ("4,074.9 / 20,000 used") and full counts, so its numbers ignore the display
mode and overflow the collapsed header.

## What Changes

- Send `credits: { used, limit }` for modelselect quota windows instead of a fixed
  label, matching the host's Copilot/Z.ai/Zhipu shape.
- Compact counts from a thousand up in the Work Status headline, keeping full
  figures in the tooltip and Usage page.
- Keep the legacy label on the wire for older clients.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `quota-credits-display-mode`: modelselect quota credits follow used/remaining mode.

### Modified Capabilities

- `extension-usage-headline`: headline compacts counts and uses credits.
- `tracker-connection-for-quota`: quota payload gains a credits field.

## Impact

- `openchamber-modelselect/service/src/view.js`, `service/src/main.js`.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Adding new quota providers.
- Changing quota percentage calculation.
