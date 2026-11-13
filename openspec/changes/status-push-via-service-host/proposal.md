# Proposal

## Why

The Work Status section polls the service every 2 s. OpenChamber 2.7.2 exposes
`serviceHost['status.set']` and `panels.emit`, which let the service push a
fresh section on demand and notify open frames. Using them removes the polling
workaround, cuts disk reads, and keeps rows current without a 2 s delay. This
supersedes `status-section-push-updates`, which only sketched the connection-event
path.

## What Changes

- Replace the 2 s host poll with `status.set` pushed from the service after each
  routing sync, quota refresh, or config change.
- Use `panels.emit` to notify open panel frames instead of re-reading.
- Keep a 2 s poll as a fallback for hosts older than 2.7.2.
- Drop the `interval: 2000` from the manifest source when the host supports push.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `status-push`: push-based status updates and the fallback poll.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest), service, rebuilt
  `service/main.js`, tests.
- Supersedes `status-section-push-updates`.
- Depends on `sdk-bump-to-canary-20261113`.
