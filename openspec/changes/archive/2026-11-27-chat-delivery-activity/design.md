# Design

## Context

See proposal.md - Why. Stable OpenChamber `2.8.1` folds replaced replies in the
chat. The guest SDK surface for the same build is turn session events with
`content.reply` and session records with `activity`/`outcome`; it has no
`delivery` or `activity` event type. The extension can consume turn events in
its service and show a truthful delivery line in its own surfaces.

## Goals / Non-Goals

**Goals:**

- Record per-session delivery state from the real SDK session-event surface.
- Show the current state and newest reply in the session action and Work Status.
- Keep the model-pick semantics untouched, including its "last known" age note.

**Non-Goals:**

- Reimplementing the host's folded chat line or guessing a wake reason the SDK
  does not send.
- Redesigning the Work Status row layout.
- Polling sessions for delivery state as a fallback to events.

## Decisions

- **Decision**: subscribe the service (`contributes.sessionEvents`) to
  `turn-started`, `turn-finished` and `turn-failed` in addition to
  `permission-asked`/`question-asked`. The service is the only component that
  receives these events; the plugin cannot.
- **Decision**: parse events with `readSessionEventRequest` and store a small
  per-session record in the service cache, separate from the plugin-owned
  status file. `turn-started` records `running` and clears the displayed reply;
  `turn-finished` records `idle` plus `content.reply` (truncated for display);
  `turn-failed` records `failed` plus the error message.
- **Decision**: record turn events even when session answers are switched off.
  Only permission/form responses stay behind that switch, so delivery state
  does not silently disappear with an unrelated setting.
- **Decision**: read the delivery record in the existing `/pick` summary and
  Work Status builder. With no record for a session, show no delivery line;
  do not infer state from status-file timestamps. Model-pick staleness keeps
  its existing, separately labelled behavior.
- **Decision**: keep the folded reply-replacement line in the host chat. A new
  `turn-finished` reply replaces the stored reply and any displayed preview;
  the extension never claims to explain what woke the agent.

## Risks / Trade-offs

- [Risk] The SDK delivers events at most once, with no replay after host or
  extension downtime -> Mitigation: absence of a record means no delivery row,
  never a guessed state; model picks stay available from their own cache.
- [Risk] Adding event types to the manifest changes the grant scope, so the
  host may ask for approval again -> Mitigation: keep `content: true` and the
  existing event list stable afterwards; document the re-approval in the
  migration plan.
- [Risk] A reply can be large (`SESSION_EVENT_REPLY_MAX` is 64 000 characters)
  -> Mitigation: store only a bounded display preview, never the full reply.
- [Risk] Host event schema drift -> Mitigation: re-audit on
  sdk-surface-audit changes; keep the delta limited to the typed event fields.

## Migration Plan

- Add the three turn events to `contributes.sessionEvents.events` in the
  manifest and accept the host's approval prompt.
- Keep the `@openchamber/sdk` floor at `>=2.8.1`; rebuild and commit the
  extension bundles after the service changes.

## Open Questions

- None blocking. The wake reason belongs to the host's folded chat line and is
  not available in `GuestSessionEventRequest`.
