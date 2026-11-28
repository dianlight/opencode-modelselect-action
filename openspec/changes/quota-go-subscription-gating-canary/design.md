# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/main.js`, `openchamber-modelselect/service/src/view.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Gate the Go quota provider on the host's subscription signal.
- Replace the fixed label and window-based `configured` heuristic.

**Non-Goals:**

- Billing or subscription changes.
- How quota numbers are computed for subscribed accounts.

## Decisions

- Use the host subscription signal as authoritative — alternatives: infer from cached windows (rejected, wrong for stale caches).
- Keep the 95/90% hysteresis for accounts that are gated in.

## Risks / Trade-offs

- Hosts below the floor lack the signal → gate on the canary floor.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
