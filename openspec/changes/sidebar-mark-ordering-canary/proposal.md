# Proposal

## Why

OpenChamber 2.7.3 puts the done hint first in a row's mark cluster and keeps
extension marks at the row's end, so extension marks no longer shift when the
done state toggles. The modelselect marks proposal (`sidebar-marks-for-modelselect`)
must set its mark assuming that fixed position and the two-mark cap, and must
not rely on the mark sitting next to the done hint.

## What Changes

- Set the mark with the assumption that it occupies the trailing slot of the
  cluster; keep text short so it survives the two-mark cap.
- Re-set the mark only when its value changes (the host already ignores
  no-op sets) and document the ordering in the README.

## Out of Scope

- Changing which rows are marked.
- Host-side ordering.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.3`.

## Capabilities

### New Capabilities

(none — adapts the marks proposal to host ordering.)

### Modified Capabilities

- `sidebar-marks`: mark position and stability.

## Impact

- `openchamber-modelselect/service/src/main.js`, README.
- Rebuilt `service/main.js`.
