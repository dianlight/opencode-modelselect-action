# Proposal

## Why

The canary adds `opencode serve --service` shared OpenCode mode with an external local plugin bridge. This lets a plugin live outside the extension and be shared across CLI, TUI, and the OpenChamber app without bundling it. The modelselect extension currently bundles its plugin (`ship-plugin-inside-extension`) — the external bridge makes that approach optional and enables a single plugin instance for all OpenCode surfaces.

## What Changes

- Declare the plugin bridge in the manifest so the extension works with shared OpenCode service.
- Support both bundled (existing) and external bridge (new) delivery paths; bundled stays the default, external is opt-in.
- Document the two paths and the tradeoffs in the README.
- Remove the `ship-plugin-inside-extension` dependency on bundling as the only path.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `external-plugin-bridge`: the extension can run with a plugin loaded via the external local bridge instead of its bundled copy.

### Modified Capabilities

- `plugin-distribution`: adds external bridge as an alternative delivery path.

## Impact

- `openchamber-modelselect/package.json`, service, tests, README.
- Depends on the shared OpenCode service mode being available.
- May allow retiring the `ship-plugin-inside-extension` bundled-build step once stable.