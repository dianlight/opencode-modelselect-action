# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/shared/usage.js`, `plugin/src/v2.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Remove subscription retry timers that outlive an aborted event stream.
- Use the host's immediate abort signal for status and quota subscriptions.

**Non-Goals:**

- Changing quota computation.
- Changing how status is rendered.

## Decisions

- Rely on the host abort signal — alternatives: shorter retry TTLs (rejected, still delayed).
- Keep the existing reconnect path for non-abort failures.

## Risks / Trade-offs

- Hosts below 2.8.1 may not signal aborts → floor `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
