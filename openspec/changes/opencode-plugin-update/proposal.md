# Proposal

## Why

OpenCode `2.3.1` added "Update Plugins from Settings", so a user can refresh a
plugin independently of the OpenChamber extension that shipped it. Once the
modelselect plugin is bundled through `contributes.opencodePlugin`, the version
OpenCode loads can drift from the version the extension expects, producing
routing behavior that no longer matches the panel and status section.

## What Changes

- Define how the extension reads the installed plugin version from the managed
  config and compares it with the version it bundles.
- Surface a clear mismatch state in the Models tab with the two versions and a
  pointer to the update action, while keeping the Models tab usable.
- Add a test for matching, mismatching and missing versions and document the
  update path in the extension README.

## Out of Scope

- Auto-updating the plugin or pinning OpenCode to a single plugin version.
- Changing how model picks are computed.
- Localizing the Models tab (covered by the status section work separately).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.3` (bundles OpenCode `2.3.2`).

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
