# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/shared/usage.js`, `plugin/src/shared/freequota.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Rely on host provider timeouts for probe failures.
- Remove local retry TTL heuristics that conflict with the host timeout.

**Non-Goals:**

- Changing provider timeout configuration.
- Changing failover ordering.

## Decisions

- Use host timeouts as authoritative — alternatives: shorten local TTLs (rejected, races with host).
- Keep failover ordering unchanged.

## Risks / Trade-offs

- Hosts below 2.8.1 may need local TTLs → floor `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
