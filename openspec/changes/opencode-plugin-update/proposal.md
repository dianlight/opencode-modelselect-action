# Proposal

## Why

OpenCode `2.3.1` added "Update Plugins from Settings", and `2.4.0` added plugin
auto-updates, so the loaded plugin can change without the extension that shipped
it. Once the modelselect plugin is bundled through `contributes.opencodePlugin`,
the version OpenCode loads can drift from the version the extension expects,
producing routing behavior that no longer matches the panel and status section.
Auto-updates remove the manual step but do not remove the need to detect drift.

## What Changes

- Define how the extension reads the installed plugin version from the managed
  config and compares it with the version it bundles.
- Surface a clear mismatch state in the Models tab with the two versions and a
  pointer to the update action, while keeping the Models tab usable.
- Add a test for matching, mismatching and missing versions and document the
  update and auto-update paths in the extension README.

## Out of Scope

- Pinning OpenCode to a single plugin version or changing the auto-update policy.
- Changing how model picks are computed.
- Localizing the Models tab (covered by the status section work separately).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (bundles OpenCode `2.4.2`).

## Capabilities

### New Capabilities

- `plugin-version-parity`: how the extension detects and reports drift between
  the bundled and the loaded modelselect plugin.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/panel/src/models-tab.js`, `panel/src/api.js`,
  `service/src/main.js`, `test/panel-frame.test.cjs`, extension README.
- Relates to the in-progress `ship-plugin-inside-extension` change.
