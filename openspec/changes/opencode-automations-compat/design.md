# Design

## Context

See `proposal.md` for motivation. `modelselect-automation-schedule` is applied:
`service/src/main.js` serves `POST /schedule` via `readServiceScheduleRequest`,
`maintain()` runs for both `routing-refresh` and `quota-probe` ids under the
existing 30 s `syncAt` throttle, and neither the `setInterval` maintain loop nor
`contributes.service.keepRunning` remains. The service starts on demand, so a
wake loads the remembered project from `store.lastProject()` when no request has
named one yet.

This change is verification and documentation only — it does not redefine the
schedule contract owned by that change.

## Goals / Non-Goals

**Goals:**

- Record a test-backed parity verdict for host automations versus the retired
  polling path.
- Make the opt-out consequence explicit for users who disable host automations.

**Non-Goals:**

- Reintroducing a timer, `keepRunning`, or an extension-side fallback.
- Redefining `/schedule`, its ids, or its payload.
- Changing routing or quota computation.

## Decisions

- Verify through `sim/` with pinned fixtures plus service tests rather than a
  live 2.4.0 host: the harness is deterministic and the wake path is already
  exercised there by `modelselect-automation-schedule`.
- Compare outcomes, not implementation: the same throttle window, the same
  immediate refresh on a switch toggle, the same no-project no-op. Rejected
  alternative: asserting on internal timers, which the companion change removed.
- Document `"automations": false` as a loss of scheduled refresh, not a rollback.
  The extension never edits the user's `opencode.json`. Rejected alternative:
  keeping the old "fall back to the extension's timers" promise — no timer
  exists to fall back to after the companion change.
- Keep the declared SDK floor in the proposal; the manifest engine floor is
  unchanged and older hosts simply deliver no wakes.

## Risks / Trade-offs

- A missed wake leaves routing stale until a switch toggle or a later wake →
  Mitigation: `/status` reads still stamp the session map, and the switch toggle
  refreshes immediately; document this convergence path.
- Users expect the old opt-out to restore polling → Mitigation: state plainly in
  the README that disabling automations stops scheduled refresh.
- Pinned fixtures can drift from a later 2.4.x host → Mitigation: re-run the
  audit whenever the bundled OpenCode version changes.

## Migration Plan

No code migration. Apply the verification and documentation tasks, then archive.
Rollback requires reverting `modelselect-automation-schedule`, not a config flag.

## Open Questions

(none)
