# Proposal

## Why

OpenChamber 2.7.1 routes project knowledge into AGENTS.md, skills and module
docs instead of agent memory. This repo already has AGENTS.md and skills; the
guidance should be aligned so project rules land in docs, not memory.

## What Changes

- Update AGENTS.md and .opencode guidance to prefer agent docs over memory.
- Move any project rules currently in memory into the relevant skill/module
  docs.
- Keep memory for personal/private setups only.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none - docs only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `AGENTS.md`, `.opencode/**`, skills.
