# Proposal

## Why

The canary folds OpenChamber Tools hints into their summaries ("settings: fold
OpenChamber Tools hints into their summaries"). This project calls
`createServiceHost().needsConfiguration(message)` with a separate multi-sentence
fix message on the extension card, which is now the redundant shape the host is
moving away from.

## What Changes

- Replace the long `needsConfiguration` message with a short summary string folded
  into the card's own summary line.
- Keep the full fix text in the README and the panel.
- Update the card states (`plugin-missing`, `managed-broken`, `no-project`) to
  the new shape.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `folded-tool-hints`: how the card summary carries the fix hint.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js` (`reportCardState`), tests.
- Rebuilt `service/main.js`.
- Could fold into `plugin-switched-off-state`.
- Depends on `sdk-bump-to-2-7-1`.
