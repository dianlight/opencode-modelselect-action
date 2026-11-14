# Proposal

## Why

The extension is pinned to `@openchamber/sdk` `2.7.1-canary.20261112.17`, while
the host canary now publishes `2.7.2-canary.20261113.19`. The newer SDK carries
the surface the proposals below depend on: `contributes.marks` with
`host.setMark`, `contributes.waits` with `readWaitStartRequest`/`readWaitCheckRequest`,
`panel.mobile` + `ready.device`, `contributes.tools` with `output: "card"`,
`contributes.blocks`, `host.setBadge`, `contributes.notifications`, `host.storage`,
and `contributes.skills`. None of these types exist in the pinned package, so
changes that use them cannot be type-checked against the real manifest schema.

## What Changes

- Bump `openchamber-modelselect` to `@openchamber/sdk`
  `2.7.2-canary.20261113.19`, reinstall, rebuild `service/main.js`,
  `panel/main.js` and `background/main.js`, and run the test suite.
- Update `engines.openchamber` to `>=2.7.2`.
- Refresh the SDK snapshot in the release-watch state.
- Document the pin and reason in `openchamber-modelselect/README.md`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — dependency move only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `bun.lock`, rebuilt bundles.
- Prerequisite for all other proposals in this list.
- Supersedes `sdk-bump-to-canary-20261112`.
