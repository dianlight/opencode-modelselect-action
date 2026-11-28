# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `plugin/src/shared/select.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Detect plan-mode rules supplied by the host and skip duplicate routing hints.
- Do not re-emit hints after compaction when the host already carries them.

**Non-Goals:**

- Changing plan-mode behavior itself.
- Removing routing hints outside plan mode.

## Decisions

- Treat host system-prompt rules as authoritative — alternatives: shorten hints (rejected, still duplicated).
- Coordinate with `routing-context-token-budget` rather than replacing it.

## Risks / Trade-offs

- Detection depends on host prompt structure → gate on `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
