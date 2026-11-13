# Proposal

## Why

OpenChamber 2.7.2 lets a service put small icons on sidebar rows via
`contributes.marks` and `host.setMark`. The modelselect extension has no visual
indicator on the session row today: the current pick (task, tier, model) is only
visible inside the Work Status section or the Models tab. Marking the active
session's row with the routed model/tier icon would surface the routing state
without opening the panel.

## What Changes

- Declare `contributes.marks: true` in the manifest and add the `marks` capability.
- In the service, call `host.setMark({ sessionId }, { icon, tone, text })` when a
  routed turn finishes, using the task's icon and tier tone; clear the mark when
  routing is off or the session is archived.
- Keep `service.keepRunning: true` (already set) so marks survive service
  restarts, and re-set them on startup.
- Add a 200-mark / 60-changes-per-minute budget guard; drop oldest marks.
- Document the surface in `openchamber-modelselect/README.md`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `sidebar-marks`: which rows are marked, what the mark shows, and its lifetime.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest, capability), service,
  rebuilt `service/main.js`, tests.
- Depends on `sdk-bump-to-canary-20261113`.
