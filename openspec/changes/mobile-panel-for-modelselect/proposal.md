# Proposal

## Why

OpenChamber 2.7.2 runs extensions on the phone: blocks, Work Status sections,
popovers, file editors and account cards work there, and a panel opts in with
`panel.mobile: true`. The modelselect panel is desktop-only today, so phone
users cannot view the routing state, change the tier, or pick a model. The panel
also uses fixed pixel sizes that need to follow `ready.device`.

## What Changes

- Set `panel.mobile: true` in the manifest.
- Read `ready.device` in the panel and switch to a ~360px-wide, touch layout
  (larger tap targets, bottom-sheet-friendly controls) when `formFactor === 'phone'`.
- Reuse the existing tabs; verify the Plugin tab form works on a phone.
- Add `mobile` to the README's supported surfaces list.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `mobile-panel`: phone opt-in and the layout it needs.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest), `panel/src/*`, rebuilt
  `panel/main.js`, tests.
- Depends on `sdk-bump-to-canary-20261113`.
