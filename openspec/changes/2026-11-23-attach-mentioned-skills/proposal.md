# Proposal

## Why

The canary attaches mentioned skills to queued and first messages. The modelselect extension ships skills (`ship-modelselect-skills`) and bridges skills/commands, but mentioned skills are dropped when a message is queued, so a queued pick loses its skill context.

## What Changes

- Preserve mentioned skills across queue and first-message send.
- Re-attach skills when replaying a queued message.
- Add a test covering skill survival through queue.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `attach-mentioned-skills`: mentioned skills survive queue and first send.

### Modified Capabilities

- `loaded-skills-context-source`: skill context is restored on replay.

## Impact

- `openchamber-modelselect/service/src/main.js`, `panel/src/main.js`.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Changes to skill resolution or bundling.