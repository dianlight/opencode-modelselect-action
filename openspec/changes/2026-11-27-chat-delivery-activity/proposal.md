# Proposal

## Why

The daily canary (OpenChamber `2.8.2-canary.20261127.33`, built on OpenCode `2.4.2`)
and the stable OpenChamber `2.8.1` release of 2026-11-26 deliver chat delivery
surfaces: replies replaced by newer replies after background work fold into one
line that says what woke the agent, and the SDK exposes composer delivery plus
background job events. The modelselect extension currently derives delivery
state with ad-hoc heuristics instead of consuming these events, which is now
redundant and keeps the experience behind the host.

## What Changes

- Consume delivery and activity events through the OpenChamber SDK for chat
  delivery state.
- Replace the heuristic delivery polling workaround with event-driven state.
- Surface the wake reason / reply replacement line in the session action and the
  Work Status.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `provider-model-selection`: the task → chat delivery contract gains a delivery
  state requirement covering reply replacement after background work.

## Impact

- `plugin/src/` delivery-state helpers, `openchamber-modelselect/service/src/`
  view and panel surfaces, `@openchamber/sdk` pin (`>=2.8.1`).

## Out of Scope

- Queued-message delivery across panels and surfaces; that is owned by the
  existing `2026-11-23-queued-messages-across-panels` change.
- Agent-side delivery of prompts to background jobs; that is owned by the
  existing `2026-11-24-wait-wake-delivery` change.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the
  `2.8.1-canary` line).
