# Proposal

## Why

OpenChamber 2.7.0 ships agent workflows where each phase can run on a
different model, and its guidance tells the agent to propose a model per phase
(cheap for reading and checking, strong for judgement and writing). This
project already maps task classes to models through `config/task-types.yaml` and
the select-model action, but nothing connects the two: a workflow author has
to pick models by hand, and the routing knowledge in this repository never
reaches the workflow.

## What Changes

- Document a mapping from OpenChamber workflow phases to this project's task
  types (research/read → `quick`/`explore`, judgement/write → `deep`/`plan`,
  verification → `test`/`review`) in `config/task-types.yaml` and the README.
- Add a workflow template under `docs/` (or the extension's shipped skills) that
  calls the select-model action per phase, so a workflow run picks the right
  model without hard-coding provider ids.
- Keep the workflow tool off by default: the template is inert until the user
  enables workflows, and never changes the session's own model.
- Add a maintenance check that fails when a task type referenced by the template
  is missing from `data/model-config.json`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `workflow-model-routing`: how modelselect's task types feed OpenChamber
  workflow phases, and how a workflow run resolves a model per phase.

### Modified Capabilities

(none)

## Impact

- `config/task-types.yaml`, `README.md`, `CHANGELOG.md`.
- Possibly `openchamber-modelselect/` shipped skills (new folder), requiring a
  build step.
- No change to the select-model action contract or to routing itself.
- No new permission.