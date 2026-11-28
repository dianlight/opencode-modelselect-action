# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/answers.js`, `openchamber-modelselect/service/src/main.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Consume the host waiting-on-you state for agent pages.
- Remove injected `PERMISSION_MESSAGE`/`PAGE_MESSAGE` text and key sniffing where the host state covers it.

**Non-Goals:**

- Changing the agent page UI.
- Auto-answering permissions unrelated to model selection.

## Decisions

- Trust host state over injected text — alternatives: broaden `normalizeKey` (rejected, brittle).
- Keep `session-control-answers-flags` active for the flags it owns.

## Risks / Trade-offs

- Hosts below the floor lack the state → gate on the canary floor.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
