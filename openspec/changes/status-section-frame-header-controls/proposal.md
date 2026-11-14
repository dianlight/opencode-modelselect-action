# Proposal

## Why

The status section is host-rendered (`contributes.statusSection.source`), so the
`Auto-update router` switch has to be a row, and `status-section-polish` pins it
last so it survives the 16-row cap. OpenChamber 2.7.1 adds `setStatusControls`:
an expanded, mounted status frame can publish up to four header controls (a button
or a select) and receive their events through `onStatusControl`. A frame-based
section moves that switch into the header, removes the last row-cap workaround,
and lets the row list be laid out by meaning instead of by survival. It is a
deliberate reversal of the host-rendered choice in `AGENTS.md`, so it needs to be
an explicit change rather than a silent migration.

## What Changes

- Declare `contributes.statusSection.entry` (small `status/` frame, built and
  committed) next to the existing `source`, and drop the `source` block.
- Register `onStatusControl` synchronously after `connectHost`, feature-gate
  `setStatusControls` with `features.statusControls`, and publish the auto-update
  router as a header select or button.
- Republish controls from `onDirectory` on every project change, since the host
  clears them.
- Move the service's freshness path from the polled `GET /status` to
  `panels.emit`, keeping `status.set` only if the source path stays.
- Keep the current rows, quota sparkline and schema-free rendering in the frame;
  do not re-create host rows.
- Rebuild and commit `status/main.js`, run `bun run check` and `bun run test`,
  update the build script and README.
- Update `AGENTS.md` so the host-rendered rule describes the new frame section.

## Out of Scope

- Changing what the rows show; that stays with `status-section-polish` and
  `status-section-host-parity`.
- The quota, pick and sync logic in the service.
- Sidebar marks, waits and other contributions.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `status-section`: rendered by a frame with header controls instead of the
  host-rendered `source` view.

## Impact

- `openchamber-modelselect/package.json` (`statusSection`), new `status/` source
  and built bundle, `service/src/main.js` (controls, `panels.emit`), build and
  check scripts, `openchamber-modelselect/README.md`, `AGENTS.md`.
- Depends on `status-push-via-service-host` for push freshness and coordinates
  with `status-section-polish` for the row budget; makes the switch row it
  pins last unnecessary.
