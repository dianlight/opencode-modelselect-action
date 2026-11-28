# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/store.js`, `openchamber-modelselect/service/src/main.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Add folder-scoped model, thinking and agent defaults to the routing store.
- Expose a folder action that applies those defaults to descendant sessions.

**Non-Goals:**

- Changing global or per-project defaults.
- Reordering sidebar marks.

## Decisions

- Precedence is session > nearest folder > project — alternatives: folder always wins (rejected, breaks manual picks).
- Keep the service as the only writer of routing state.

## Risks / Trade-offs

- Nested folders need deterministic precedence → document and test the nearest-folder rule.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
