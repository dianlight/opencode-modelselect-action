# Proposal

## Why

OpenChamber 2.7.1 sends `theme.tokens.fontSize` (the app's body text in px, following
Appearance → Interface font size) and `applyHostReady` makes it the frame's `1rem`.
The SDK kit already scales because its classes are rem-based, but the modelselect
panel's custom CSS in `panel/src/dom.js` uses hardcoded px (10–13px) for the
`.mp-*` classes, so the panel content stays at a fixed size regardless of the
user's interface font size. This is the last hardcoded-size workaround in the panel.

## What Changes

- Convert the `.mp-*` font sizes in `panel/src/dom.js` from px to rem (root = 14px)
  so they scale with `applyHostReady`'s root font-size.
- Convert icon/badge geometry (14px svg) to rem where it should grow with text;
  keep borders in px.
- Rebuild `panel/main.js` and run `bun run check` / `bun run test`.
- Document the scaling behavior in `openchamber-modelselect/README.md`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none — panel CSS change only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/panel/src/dom.js`, rebuilt `panel/main.js`.
- No manifest or permission change.
- Depends on `sdk-bump-to-canary-20261112`.
