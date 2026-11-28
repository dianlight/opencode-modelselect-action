# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/main.js`, `plugin/src/v2.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Stop issuing reloads when the routing write does not change a config feed.
- Keep a reload only for writes that alter a watched config feed.

**Non-Goals:**

- Changing host config watch behavior.
- Removing plugin setup actions.

## Decisions

- Trust host feed detection — alternatives: keep defensive reload bursts (rejected, unnecessary churn).
- Keep `skip-unchanged-guest-instructions-write` active; this change aligns the reload path.

## Risks / Trade-offs

- Hosts below 2.8.1 may need explicit reloads → floor `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
