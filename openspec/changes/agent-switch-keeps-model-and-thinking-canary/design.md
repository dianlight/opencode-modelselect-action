# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `plugin/src/shared/select.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Keep the session model and thinking variant across agent switches instead of recomputing them.
- Stop emitting a new routing annotation on an agent switch that does not change the model.

**Non-Goals:**

- Changing the model when the user explicitly picks a new one.
- Changing how agent instructions are authored.

## Decisions

- Read continuity from the host session ref rather than from the detector — alternatives: cache in the plugin (rejected, diverges from host state).
- Keep `withVariant` merging so a manual variant still wins over a task hint.

## Risks / Trade-offs

- Mixed-version hosts may not expose continuity → gate on the canary floor.
- Continuity must not block an explicit model change → always honor a user pick.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
