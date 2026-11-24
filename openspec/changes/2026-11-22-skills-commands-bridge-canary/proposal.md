# Proposal

## Why

The canary adds `skills/commands` bridge so extensions can share OpenCode service mode with plugins. The modelselect extension ships skills in `openchamber-modelselect/skills/`, but the plugin is bundled inside the extension. The skills bridge lets the host load skills from the extension's folder while the plugin runs externally, enabling shared service mode without duplication.

## What Changes

- Add `contributes.skills` to the extension manifest pointing to `openchamber-modelselect/skills/`.
- Ship skills as part of the extension package (same as plugin).
- Allow the extension to load skills from the host's managed OpenCode config while using the external plugin bridge.
- Document the bridge and how skills stay in sync with the plugin.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `skills-commands-bridge`: extensions can share OpenCode service mode with plugins via shared skills.

### Modified Capabilities

- `plugin-distribution`: allows skills to be shared while plugin runs externally.

## Impact

- `openchamber-modelselect/package.json`, `openchamber-modelselect/skills/`, `README.md`.
- May simplify `ship-modelselect-skills` by removing the need to bundle skills separately.
- Depends on `external-plugin-bridge-canary`.