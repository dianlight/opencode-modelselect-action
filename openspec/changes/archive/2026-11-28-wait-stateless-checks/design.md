# Design

## Context

See `proposal.md` - Why. The current state that shapes the approach:

- The service (`openchamber-modelselect/service/src/`) currently answers no wait
  routes at all. The wait surface (`contributes.waits`, `WAITS_START_PATH` /
  `WAITS_CHECK_PATH`, `readWaitStartRequest` / `readWaitCheckRequest`) arrives with
  the canary SDK (`@openchamber/sdk` `2.7.3-canary.20261117.23`; stable OpenChamber
  `>=2.7.3`).
- `modelselect-quota-wait` planned to track latch state in the service's data
  folder; `adopt-service-data-dir` (completed) had just established that seam, so
  planned wait writes would have landed under the service data folder. The canary
  invariant makes that tracking unnecessary - and unsafe.
- The live state a stateless check reads already exists behind store seams:
  `store.readLatch` (`free-quota.json`) and `store.readRoutingSync`
  (`routing-sync.json`) over the plugin cache; the chain failover and view
  countdowns already consume the same latch.

## Goals / Non-Goals

**Goals:**

- Answer `WAITS_CHECK_PATH` statelessly: from the request context plus a live read
  of the latch/sync state, with no wait state held by the service.
- Never persist wait state (and hold no in-memory wait mirror either).
- Return the current state on every check, so a check that fires after a change
  reports the change, not the state captured at wait start.

**Non-Goals:**

- Wait type ids, intervals and the `wake` capability (proposal out of scope).
- Host-side wait bookkeeping (the host owns the wait).

## Decisions

- **D1 - No wait state in the service, persisted or in memory.** The service is a
  pure answerer: it keeps no wait record of its own, so a restart between checks
  cannot leave stale or disagreeing state. The host owns the wait.
- **D2 - Live reads are the freshness mechanism; the request carries context.**
  The check reads the latch and sync state live via the existing store seams and
  treats that read as authoritative for the answer; the request's `state` carries
  the wait context (condition identity / params) the check is about.
- **D3 - Response shape is pinned: `fired` plus a summary payload.** A check
  returns `{ fired, summary }` where `summary` carries the current state (latched
  model, countdown / reset time, sync status) at answer time. The design pins this
  so tasks do not re-litigate it.
- **D4 - Restart safety comes from statelessness, not from migration.** Nothing to
  migrate; a restarted service simply answers from the next live read. The host
  must keep the wait alive across a service restart (immediate wake delivery per
  the wake-delivery change).

**Alternatives considered:** persisting the latch in the service data folder
(rejected - the invariant obsoletes it and it can disagree with the host's copy);
holding an in-memory mirror per wait (rejected - it goes stale on restart and
duplicates host-owned state).

## Risks / Trade-offs

- **Live read per check** -> acceptable: both files are small and written via the
  existing atomic-write seam; cost moves from state-keeping to constant reads.
- **Host/service state disagreement** -> live read means the answer reflects the
  host-visible copy; if the host passes contradictory context, the live read wins
  (D2). Failing loudly on contradiction is an open question, not decided here.

## Migration Plan

1. Land canary SDK wait surface support in the service routes.
2. Answer checks statelessly; drop any wait-state write path.
3. Switch wake delivery to the immediate-delivery rule; script waits reuse the
  stateless check runtime.

## Open Questions

- Whether the check response needs anything beyond `fired` + `summary` (e.g. a
  retry hint). Deferred; does not change the spec.
