# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/view.js`, `openchamber-modelselect/panel/src/status-tab.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Summarize pick, failover and quota activity in a fixed number of words.
- Close the running fold when the host closes it instead of leaving a stale row.

**Non-Goals:**

- Changing host grouping of tool calls.
- Removing the status section itself.

## Decisions

- Follow the host fold lifecycle rather than a local timer — alternatives: TTL cleanup (rejected, races with host).
- Keep the status schema valid for every summary variant.

## Risks / Trade-offs

- Summaries must stay within the status row budget → verify with the existing frame test.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
