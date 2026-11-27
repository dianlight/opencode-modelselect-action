# Proposal

## Why

OpenChamber Canary adds script waits: an agent can wait on a condition it writes
itself (a script that runs on the host without model turns, up to H hours, waking
the session when it returns `{ wake }`). The modelselect extension currently
implements waits through polling and timers (`modelselect-quota-wait`,
`modelselect-automation-schedule`), which cost model turns and lag behind events.
Script waits let quota-reset and scheduled routing checks run without a model,
waking the session only when something actually changed.

## What Changes

- Use `wait.start` with `source: "script"` for quota-reset waits instead of
  timer polling; the script checks the blended quota snapshot and wakes on change.
- Use script waits for scheduled routing sync checks, replacing the service-side
  polling loop.
- Gate script waits on OpenCode 2.4+ (they are unavailable before); fall back to
  the existing timer/polling path on older runtimes.
- Delete the now-redundant polling helpers once the script path is stable.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `script-waits-for-modelselect`: modelselect uses host script waits for quota and
  routing checks.

### Modified Capabilities

- `modelselect-quota-wait`: quota waits become script-based.
- `modelselect-automation-schedule`: scheduled checks become script-based.
- `wait-stateless-checks`: stateless checks reuse the script wait runtime.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/view.js`.
- `scripts/opencode_maintenance.py` consumers of wait state.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Adding new wait sources beyond script.
- Changes to the host wait runtime itself.
