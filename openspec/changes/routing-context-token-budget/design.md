# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `plugin/src/shared/select.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Replace per-turn annotations with keyed session instructions that can be updated without repetition.
- Define a token budget for routing hints and skip unchanged writes.

**Non-Goals:**

- Removing routing visibility entirely.
- Changing host Code Mode behavior.

## Decisions

- Use keyed session instructions — alternatives: shorter annotation strings (rejected, still repeated).
- Coordinate with `skip-unchanged-guest-instructions-write` instead of superseding it.

## Risks / Trade-offs

- Budget needs measurement → add a sim assertion on emitted text length.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
