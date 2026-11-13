# Proposal

## Why

OpenChamber 2.7.2 lets an agent wait on something an extension follows via
`contributes.waits`. The modelselect extension follows the free-tier latch
(countdown) and the routing sync, but exposes no wait today, so an agent that
needs a quota to reset must poll or fail. A wait type would let the agent pause
until the latch clears or the sync finishes, then wake with a summary.

## What Changes

- Declare `contributes.waits` with at least one type, e.g. `quota-reset`
  (interval 30 s) and `routing-sync` (interval 10 s), with params for the
  project directory.
- Serve `WAITS_START_PATH` and `WAITS_CHECK_PATH` from the service, reading
  requests with `readWaitStartRequest`/`readWaitCheckRequest`.
- On check, report `fired: true` with a summary when the latch clears or the
  sync completes; `fired: false` with the updated state otherwise.
- Add the `wake` capability to the approval flow and document the wait ids.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `modelselect-waits`: which waits the extension offers and when they fire.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest, capability), service,
  rebuilt `service/main.js`, tests.
- Depends on `sdk-bump-to-canary-20261113`.
