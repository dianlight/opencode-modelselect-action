# Proposal

## Why

OpenChamber 2.8.2-canary.20261127.33 (PR 7589) loads a symlinked TS plugin's own imports. `ship-plugin-inside-extension` currently has to copy or bundle the plugin for local development because imports break through a symlink.

## What Changes

- Allow the extension's plugin to be symlinked from its source tree during development.
- Remove the development-only copy step where the host resolves imports.
- Keep the shipped bundle self-contained for release builds.

## Out of Scope

- Changing the published bundle layout.
- Adding new plugin runtime behavior.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261127.33`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `symlinked-plugin-development`: defines how a symlinked OpenCode TypeScript plugin resolves its own imports.

### Modified Capabilities

(none)

## Impact

- `plugin/package.json`
- `openchamber-modelselect/package.json`
- `openspec/changes/ship-plugin-inside-extension/proposal.md`
- development docs
