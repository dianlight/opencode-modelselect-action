# Design

## Context

See `proposal.md` for motivation. The service owns file I/O and currently runs
`MAINTAIN_EVERY_MS` from a `setInterval` started on listen. SDK `2.7.2` exposes
`contributes.service.schedule`, `SERVICE_SCHEDULE_PATH` and a schedule request
parser; the service already handles control events on the same loop.

## Goals / Non-Goals

**Goals:**

- Replace the self-driven refresh clock with host-driven wakes.
- Preserve throttle and toggle behavior exactly.

**Non-Goals:**

- Changing routing or quota computation.
- Redesigning the status section.

## Decisions

- Declare two schedule entries, routing refresh and quota probe, rather than
  one combined entry so each cadence can be tuned.
- Reuse the existing `maintain()` work for both wakes, keyed by the schedule
  id, and keep the per-project `syncAt` throttle as the single freshness gate.
- Drop `keepRunning` only after the schedule path is covered by tests; until
  then both mechanisms would double-refresh.
- Treat OpenCode `2.3.1` automations as the plugin-side probe path, verified in
  the sim harness rather than wired into the service.

Alternatives considered: keeping the interval (rejected, it defeats the
purpose) and polling from the panel (rejected, the panel has no file I/O).

## Risks / Trade-offs

- A missed host wake leaves data stale → Mitigation: the status read still
  triggers a throttled refresh, so freshness converges on next view.
- Schedule ids become part of the manifest contract → Mitigation: keep them
  stable and document them in the README.

## Migration Plan

Ship with both mechanisms briefly, verify schedule runs arrive, then remove
`keepRunning` and the interval. Rollback restores the manifest and interval.

## Open Questions

(none)
