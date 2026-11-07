# Proposal

## Why

The host-rendered Work Status section has been squeezed into a shape that
predates two host features: the answer is capped at 16 rows, so the
`Auto-update router` switch is pinned to "always last so it survives the cap",
and rows carry no icon although every `line` accepts a Remixicon name. The
answer is also rebuilt from disk every two seconds, and the Go monthly quota —
the number users actually watch — is a single bar with no history. The canary
adds nothing here; the section simply has not caught up with the contract it
already targets, and the row budget will only get tighter as more quota rows
land.

## What Changes

- Move `Auto-update router` from a row to the section's header `controls` (a
  native switch) and take its `POST` on the same path; one more row is free and
  the switch is reachable while the section is collapsed.
- Give every row a stable Remixicon `icon` (`task`, `tier`, `model`, `think`,
  `jev`, `source`, `updated`, `quota`, `free`) from a whitelist, so an unknown
  name is never sent and the section never fails to parse.
- Document and enforce a drop order: notes last, budget models before the Go
  window, the pick always kept. A test fills the budget and asserts what
  disappears first.
- Render the Go monthly window with a `chart` sparkline of the last readings
  (in memory, ≤120 points, cleared on restart) beside the existing bar, and the
  used percentage as `value`.
- Validate the built answer against `guestStatusViewSchema` in the service tests
  before it ships, so a contract drift is a red test rather than a blank section
  on a user's machine.
- Answer every poll from the snapshot when `adopt-opencode-role` is in place, so
  the two-second interval costs no disk work; keep the current file read as the
  fallback.

## Capabilities

### New Capabilities

- `status-section`: what the section shows, in which order, what it drops under
  the row cap, and how its controls behave.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/view.js` (row construction, icons,
  priority), `view.test`-style coverage through `test/status-service.test.cjs`,
  `service/src/main.js` (control handling, history ring buffer).
- `openchamber-modelselect/README.md` (row list, drop order, switch location).
- No new permission, no manifest change; rebuilt `service/main.js`.
- Depends on `adopt-opencode-role` for the disk-free path; the row work stands
  alone.
