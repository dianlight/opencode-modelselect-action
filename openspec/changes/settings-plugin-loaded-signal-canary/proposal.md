# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 (PR 7748) stops offering the OpenCode plugin when it is already loaded. The extension still sniffs `~/.config/opencode/opencode.json(c)` with a hand-written JSONC tokenizer and `/modelselect/i` regex to guess that state.

## What Changes

- Consume the host's loaded-plugin signal instead of parsing the managed config.
- Remove the JSONC tokenizer and config text-replacement path in `service/src/store.js`.
- Keep the Models tab usable when the plugin is loaded, missing or switched off.

## Out of Scope

- Changing plugin installation itself.
- Changing model picks or task detection.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `plugin-loaded-state`: defines how the extension learns from Settings that the OpenCode plugin is already loaded.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/store.js`
- `openchamber-modelselect/panel/src/plugin-tab.js`
- `openchamber-modelselect/service/src/main.js`
