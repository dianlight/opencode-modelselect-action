# Proposal

## Why

OpenCode 2.4.0 fixed Markdown commands that dropped `variant` when they carried `model`. The project has no shipped command or skill frontmatter yet, so a future model-selection command must include both fields to avoid reintroducing the bug.

## What Changes

- Ship a model-selection Markdown command with both `model` and `variant` frontmatter.
- Add a regression check that a command keeps the thinking variant beside the model.
- Allow the command to omit `variant` only when the task has no thinking hint.

## Out of Scope

- Adding commands for unrelated workflows.
- Changing the picker UI.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `markdown-command-model-variant`: defines how model-selection Markdown commands preserve thinking variants.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/commands/`
- `openspec/changes/ship-modelselect-skills/proposal.md`
- `plugin/src/v2.js`
- sim fixture for command frontmatter
