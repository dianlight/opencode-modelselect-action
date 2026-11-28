# Proposal

## Why

OpenCode 2.4.0 lets plugin tools declare `options.codemode` with its own description and schemas. The `model-pick` tool currently relies on generic tool argument inference.

## What Changes

- Declare `options.codemode` for the `model-pick` tool with a task-type and tier schema.
- Keep the non-Code-Mode tool surface unchanged.
- Validate picks against the declared schema before applying them.

## Out of Scope

- Adding new tool parameters beyond task type and tier.
- Changing the action labels in the manifest.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `plugin-tool-codemode`: defines Code Mode options for the model-pick tool.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `openchamber-modelselect/package.json`
- `openspec/changes/modelselect-pick-tool-card/proposal.md`
