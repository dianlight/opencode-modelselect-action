# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 (PR 7742) allows private-network Git hosts and SSH aliases and installs private extensions over HTTPS with a chosen GitHub account. The project distributes the bundled plugin and extension from a Git source that can be private.

## What Changes

- Document and test private Git sources for the extension and bundled plugin.
- Support SSH aliases and private-network hosts in the development setup without exposing credentials in bundles.
- Keep public installation unchanged.

## Out of Scope

- Changing the published extension manifest.
- Adding credentials to committed artifacts.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `private-extension-sources`: defines how private extensions install and update from private-network Git hosts and SSH aliases.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/README.md`
- `plugin/README.md`
- `openspec/changes/ship-plugin-inside-extension/proposal.md`
- development docs
