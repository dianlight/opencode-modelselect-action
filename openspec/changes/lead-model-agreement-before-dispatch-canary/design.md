# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/shared/detect.js`, `plugin/src/v2.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Require an explicit model agreement from the lead before any subagent dispatch, surfaced through the modelselect action or agent page.
- Stop using prompt ACK-word and regex heuristics in `plugin/src/shared/detect.js` to infer a delegated model.

**Non-Goals:**

- Auto-dispatching work without user involvement.
- Changing stateless Small Model picks.

## Decisions

- Use the host lead-agreement surface instead of broadening `PROMPT_RULES`; broader regexes stay ambiguous.
- Keep the service as the only owner of file I/O; the panel continues to call it through `panel/src/api.js`.

## Risks / Trade-offs

- Older hosts lack the surface → gate on the canary floor and keep current behavior below it.
- Lead agreement adds a user step → keep the picker non-blocking so the session remains usable.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
