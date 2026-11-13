# Proposal

## Why

The extension is pinned to `@openchamber/sdk` `2.6.2-canary.20261107.11`, while
the host canary publishes `2.7.1-canary.20261111.16` (GitHub) and
`2.7.1-canary.20261112.17` (npm). The newer SDK carries the surface the active
proposals depend on: `theme.tokens.fontSize`, `contributes.links`,
`contributes.providerLogos`, `sessions.stop`/`answerPermission`/`answerForm`,
`sessionControl.answers`, question forms in `question-asked` events, and
`contributes.waits`. None of these types exist in the pinned package, so changes
that use them cannot be type-checked against the real manifest schema.

## What Changes

- Bump `openchamber-modelselect` to `@openchamber/sdk`
  `2.7.1-canary.20261112.17`, reinstall, rebuild `service/main.js`,
  `panel/main.js` and `background/main.js`, and run the test suite.
- Update `engines.openchamber` to `>=2.7.1`.
- Refresh the SDK snapshot in the release-watch state.
- Document the pin and the reason for a canary pin in
  `openchamber-modelselect/README.md`.

## Capabilities

### New Capabilities

(none — dependency move only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `bun.lock`, rebuilt bundles.
- Prerequisite for every proposal that uses the new SDK surface.
- No behavior change on its own.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261112.17`.
- Stable: OpenChamber `>=2.7.1`.

## Out of scope

- Any runtime behavior change; this is a dependency move only.
