# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/main.js`, `openchamber-modelselect/package.json`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Rely on `actions.run` readiness instead of port guessing and forced reloads.
- Remove `reloadPorts()` and its `config-reload` callers from `service/src/main.js`.

**Non-Goals:**

- Changing how actions are declared in the manifest.
- Removing the service schedule entries.

## Decisions

- Defer to host readiness — alternatives: keep `reloadPorts()` with more candidates (rejected, still racy).
- Keep per-project throttle semantics from `modelselect-automation-schedule`.

## Risks / Trade-offs

- Hosts below the floor may start actions early → gate on the canary floor.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
