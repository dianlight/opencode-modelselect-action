# Proposal

## Why

OpenCode 2.2.7 lets predicate questions in `client.experimental.generate.decisions`
accept optional `criteria: { true?, false? }` to define acceptance conditions.
The modelselect extension's decision generation (quota/provider-configured state)
uses boolean predicates without criteria, so decisions lack structured
acceptance conditions.

## What Changes

- Update decision generation calls to pass `criteria: { true, false }` where
  applicable.
- Use criteria to drive quota/provider-configured state decisions.
- Add tests for criteria-driven decisions.

## Out of Scope

- Changing the decision model itself.
- Adding new decision types.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `predicate-questions-criteria`: modelselect uses criteria in decisions.

### Modified Capabilities

- `quota-provider-configured-state`: decisions gain criteria.

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- Plugin decision helpers.
