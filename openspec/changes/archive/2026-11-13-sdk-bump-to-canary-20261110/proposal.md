# Proposal

## Why

The extension is pinned to `@openchamber/sdk` `2.7.1-canary.20261109.13` (or
stable `2.7.0`), while the host canary now publishes `2.7.1-canary.20261110.14`.
The newer SDK carries the surface the proposals below depend on: `tool` and
`context` on session records, `inWork`/`unread`, page-only extensions,
`contributes.providerLogos`, `contributes.links`, service-owned sign-in,
`sessions.stop`/`answerPermission`/`answerForm`, and connection events. None of
these types exist in the pinned package, so changes that use them cannot be
type-checked against the real manifest schema.

## What Changes

- Bump `openchamber-modelselect` to `@openchamber/sdk`
  `2.7.1-canary.20261110.14`, reinstall, rebuild all three bundles, run tests.
- Update `engines.openchamber` to `>=2.7.1`.
- Refresh the SDK snapshot in release-watch state.
- Document the pin and reason in `openchamber-modelselect/README.md`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none - dependency move only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `bun.lock`, rebuilt bundles.
- Prerequisite for all other proposals in this list.
