# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/store.js`, `openchamber-modelselect/service/src/view.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Use host cost estimates that include service-tier and long-context prices.
- Remove local cost bounds and guessed prices from the store.

**Non-Goals:**

- Changing quota numbers.
- Changing which model is selected.

## Decisions

- Consume host estimates instead of local bounds — alternatives: refresh a price table (rejected, duplicates host data).
- Keep free/paid routing independent of displayed cost.

## Risks / Trade-offs

- Hosts below 2.8.1 lack tier prices → floor `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
