# Proposal

## Why

Stable OpenChamber `2.8.1` (2026-11-26, bundled OpenCode `2.4.2`) ships grouped
chat activity and folds a reply replaced by newer background work into one line
saying what woke the agent. Auditing the matching SDK
(`@openchamber/sdk@2.8.2-canary.20261127.33`) showed that this folding is host
UX: the guest SDK has **no** `delivery` or `activity` event type. Its session
events are `turn-started`, `turn-finished`, `turn-failed`, `permission-asked`,
`question-asked`, `session-created`, `session-archived` and `session-deleted`;
a `turn-finished` request carries `content.reply`, and session records expose
`activity`/`outcome` through the workspace API.

The modelselect service already receives session events but only subscribes to
the two ask types. Its Work Status and session action show the last model pick,
with a deliberate "last known" age fallback and no delivery state. That makes
an event-driven per-session delivery line the honest, implementable slice of
the 2.8.1 behavior: read the host's turn events, not a non-existent event or a
local timer.

## What Changes

- Subscribe the service to `turn-started`, `turn-finished` and `turn-failed`
  alongside the existing ask events, keeping the `content` grant for replies.
- Record per-session delivery state in the service cache from
  `readSessionEventRequest`: running/idle/failed, event time, latest reply and
  failure message. Ask-event handling stays behind the session-answers switch;
  turn events are recorded regardless of it.
- Show that state in the existing session action toast and Work Status,
  replacing an older reply with the newest one and omitting the line entirely
  when no event has been seen.
- Leave the folded "what woke the agent" line in the chat to the host. The
  SDK does not carry a wake reason, and the extension does not draw a second
  replacement line.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `provider-model-selection`: the task → chat delivery contract gains a
  delivery-state requirement covering the host turn events and reply
  replacement.

## Impact

- `openchamber-modelselect/package.json` session-event subscription.
- `openchamber-modelselect/service/src/{main,store,view}.js` and their unit,
  service and sim tests; rebuilt `service/main.js` bundle.
- `@openchamber/sdk` floor `>=2.8.1` (stable), matching the release that
  introduced the folded reply behavior.

## Out of Scope

- Drawing the host's folded reply-replacement line or inventing a wake reason;
  neither is exposed to guest extensions.
- Queued-message delivery across panels and surfaces; that is owned by the
  existing `2026-11-23-queued-messages-across-panels` change.
- Agent-side delivery of prompts to background jobs; that is owned by the
  existing `2026-11-24-wait-wake-delivery` change.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the
  `2.8.1-canary` line).
