# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/view.js`, `plugin/src/shared/core/routing.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Update routing and status cache locations when a session moves.
- Carry subagent routing state with the parent session.

**Non-Goals:**

- Changing the host session-move command.
- Changing model selection logic.

## Decisions

- Use the host move event as the trigger — alternatives: rescan directories (rejected, expensive).
- Keep cache filenames unchanged so existing readers keep working.

## Risks / Trade-offs

- A move during a turn may race → apply cache updates idempotently.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
