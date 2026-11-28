# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `core/catalog.js`, `plugin/src/v2.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Consume `experimental.model_speeds` for known speed tiers.
- Stop synthesizing tier-suffixed picker rows from `VARIANT_SUFFIXES`.

**Non-Goals:**

- Changing model scoring or task-type definitions.
- Removing the free/paid variant distinction.

## Decisions

- Use host speed state as the source of truth — alternatives: keep suffix synthesis (rejected, duplicates host data).
- Retain `core/catalog.js` canonicalization for config compatibility.

## Risks / Trade-offs

- 2.8.1 bundles OpenCode 2.4.2 → floor `>=2.8.1`; hosts below it need the synthetic rows.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
