# Design

## Context

See `proposal.md` — Why. Constraints found in the code and the host:

- `service/src/main.js` computes presence in `pluginEntry()`: a regex over
  `GLOBAL_NOTE_PATHS` cached for 30 s, plus `readView()`'s three states
  (`no-project`, `plugin-missing`, `no-pick`). Nothing looks at the age of a
  pick when deciding.
- `view.js` already renders a `last known` badge on the `Updated` row past
  roughly ten minutes — the threshold exists and is only used cosmetically.
- OpenChamber's plugin switches live in OpenChamber's own store and reach
  OpenCode as `policies` denials; neither the file nor the store is in the
  extension's declared `filesystem` paths, and the host exposes no read for it
  to a guest.
- The `opencode` role lists sessions and their status but not plugins.
- `contributes.opencodePlugin` reports delivery once per catalog read as
  `opencodePlugins.delivery` (`file`, `restart`, `none`, `remote`).

## Goals / Non-Goals

**Goals:**

- No claim the evidence does not support, in either direction.
- One row, short, with a next step.
- States that survive the migration from a hand-installed plugin.

**Non-Goals:**

- Detecting the switch itself (not readable; see D1).
- Offering a button that changes OpenChamber's plugin list.
- Replacing OpenChamber's own Settings → Plugins diagnostics.

## Decisions

**D1 — Infer, never read.** The switch is not readable by a guest, so the
extension reports "not producing picks" and names the two causes. Alternative
rejected: adding OpenChamber's plugin-switch file to `filesystem` — it is inside
OpenChamber's data directory, which the docs explicitly exclude from the guest
contract, and the path is not stable across modes.

**D2 — Evidence ladder.** `running` (pick ≤10 min) → `stale` (pick exists,
older) → `not-running` (delivery `file`, sessions active, no pick) → `no-pick`
(delivery `file`, nothing active, no pick ever) → `not-delivered` (delivery
`restart`/`none`/`remote`). A pick always wins over the root-cause states
because it proves the plugin ran. There is no `no-project` state any more:
`requiresProject: true` hides the section entirely.

**D3 — Ten minutes, shared with the badge.** One constant
(`STALE_AFTER_MS`) drives both the `Updated` tone and the presence state, so the
screen cannot say "just now" and "not running" at the same time.

**D4 — `legacy-entry-missing` is temporary.** Until `ship-plugin-inside-extension`
lands, a missing config entry still means the plugin was never installed; after
that, the entry is OpenChamber's and the state is deleted from the code. Marked
in the state table, not just in a comment.

**D5 — The presence row is a `note`, not a `line`.** A note does not count as a
label/value row, keeps the row budget for data (see `status-section-polish`), and
is already the shape used for the free-tier latch. Tones: `warning` for
`stale`/`not-running`, `info` for `not-delivered`, `muted` for `no-pick`.

**D6 — Session evidence needs the role, and the state must not pretend
otherwise.** Without `opencode`, `not-running` and `no-pick` collapse into one
state because there is no way to tell "sessions run but nothing routes" from
"nothing has run yet"; the message then says less rather than guessing.

## Risks / Trade-offs

- **A user who switched the plugin off deliberately** sees a warning forever →
  the copy names that exact case first, so the warning is the confirmation they
  expect, not noise.
- **A quiet project** looks `stale` → correct, and the badge already said so;
  the note adds the reason.
- **Evidence races** (a pick written between two reads) → the next answer
  corrects it, within 2 s.
- **A future host exposing plugin state** would make D1 obsolete → the state
  machine takes its evidence as inputs, so a new source is one function.

## Migration Plan

1. Ship the state machine behind the existing states; `running`/`no-pick`
   render as today.
2. Ship `legacy-entry-missing`; remove it in the release that lands
   `ship-plugin-inside-extension`.
3. Rollback: the old boolean is one function; reverting restores it.

## Open Questions

- Whether the presence note should offer a `controls` action that opens
  OpenChamber's Settings → Plugins. The contract has no navigation action;
  deferrable.
