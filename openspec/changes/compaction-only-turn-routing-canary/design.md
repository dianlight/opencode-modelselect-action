# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `plugin/src/shared/select.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Detect compaction-only turns from host session events instead of prompt text.
- Skip routing announcements and status-file writes on those turns.

**Non-Goals:**

- Turns that contain user-visible output.
- Changing host compaction behavior itself.

## Decisions

- Trust the host event as the single source of truth — alternatives: prompt regex (rejected, false positives).
- Keep the existing status throttle intact for normal turns.

## Risks / Trade-offs

- Hosts below the floor do not mark compaction turns → gate on the canary floor.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
