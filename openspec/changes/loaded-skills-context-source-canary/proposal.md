# Proposal

## Why

OpenChamber 2.7.3 lists the skills an agent loaded in Context sources, so a
shipped skill is now visible where the user already looks. The modelselect
extension proposes shipping a `modelselect` skill (`ship-modelselect-skills`);
surfacing it in Context sources makes the routing knowledge reachable without
opening the panel, and makes a missing skill obvious.

## What Changes

- Ship the `modelselect` skill so it is loaded and shown in Context sources.
- Keep the skill text in sync with `config/task-types.yaml` so the listed skill
  matches the routed pick.
- Document the Context sources entry in the README.

## Out of Scope

- Changing routing logic.
- Shipping non-modelselect skills.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.3`.

## Capabilities

### New Capabilities

(none — consumes a host surface.)

### Modified Capabilities

- `modelselect-skills`: visibility in Context sources.

## Impact

- `openchamber-modelselect/package.json` (`contributes.skills`),
  `openchamber-modelselect/skills/modelselect/SKILL.md`, README.
