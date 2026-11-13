# Proposal

## Why

The extension ships an OpenCode plugin and a settings panel, but no agent-facing
skills. OpenChamber's `contributes.skills` lets an extension carry a folder of
`<name>/SKILL.md` skills that the host lists in the managed OpenCode config while
the extension is enabled. The project's routing knowledge — task types, the model
chain, how to read the Work Status section — lives in the repository's
`AGENTS.md` and `.opencode/skills/`, and never reaches the OpenChamber user or
the agent working in the project.

## What Changes

- Add `contributes.skills` pointing at a `skills/` folder in
  `openchamber-modelselect/`.
- Ship a `modelselect` skill (`skills/modelselect/SKILL.md`) covering: the
  task-type → model mapping, how the plugin picks a model, and how to read the
  Work Status section and the settings panel.
- Keep the skill text in sync with `config/task-types.yaml` and the README.
- Document the skill in `openchamber-modelselect/README.md`.

## Capabilities

### New Capabilities

- `modelselect-skills`: which skills the extension ships, what they teach, and
  how they stay in sync with the routing config.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (`contributes.skills`),
  `openchamber-modelselect/skills/modelselect/SKILL.md`,
  `openchamber-modelselect/README.md`.
- No new permission beyond `skills`; no service or panel change.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Out of scope

- Changing the routing logic or the plugin's behavior.
- Shipping the repository's OpenSpec workflow skills.
