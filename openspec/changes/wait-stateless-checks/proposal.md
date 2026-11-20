# Proposal

## Why

The canary SDK adds the invariant: wait state is host-owned and accompanies every
check, so a service can restart between checks without retaining state.
`modelselect-quota-wait` plans to track latch state in the service's data folder;
that state is unnecessary and can disagree with the host's copy. Answering from
the check body alone removes the store and the disagreement.

## What Changes

- Answer `WAITS_CHECK_PATH` from the request's `state` plus a live read of the
  latch/sync state; persist nothing for waits.
- Return the current state on every check so the host's copy stays fresh.
- Drop wait-state writes from `adopt-service-data-dir`'s scope; add a test that a
  restarted service answers correctly from the body alone.

## Out of Scope

- Wait type ids, intervals and the `wake` capability.
- Host-side wait bookkeeping.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.3` (released 2026-11-19).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `modelselect-waits`: checks are stateless; the service keeps no wait state.

## Impact

- `openchamber-modelselect/service/src/main.js` (waits routes), tests, README.
- Depends on `modelselect-quota-wait`; narrows `adopt-service-data-dir`.
