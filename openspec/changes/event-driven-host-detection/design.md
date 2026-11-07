# Design

## Context

See `proposal.md` — Why. Constraints found in the code:

- `plugin/src/shared/host.js` owns the read side: `resolveHost()` consults the
  explicit option, the environment, then the session map with a
  `{ mtimeMs, size }` cache, and exports `SESSION_MAP_TTL_MS = 30 d` with a
  comment that it mirrors the extension.
- `openchamber-modelselect/service/src/main.js` owns the write side:
  `HOST_EVIDENCE_KEY = 'openchamber'`, `SESSION_MAP_TOUCH_MS = 60 s`,
  `touchSessionMap()` prunes by TTL and stamps `statuses.map(s => s.sessionID)`.
- The extension may only write inside the project (`.opencode/.modelselect-cache`),
  which is what makes detection work for a mobile-driven session too.
- `contributes.sessionEvents` accepts 1–4 distinct events and needs a `service`;
  the delivery is at-most-once, in order, with a 30 s backoff after a failure.
- The service is stopped after ten idle minutes, so "extension installed but
  closed" must still count for a while — the heartbeat window is deliberately
  longer than that.

## Goals / Non-Goals

**Goals:**

- Short, honest evidence: absence of the extension is noticed in minutes.
- No synthetic ids, no per-model guessing, no duplicate TTL constants.
- One place that defines the file, consumed by both sides.

**Non-Goals:**

- Detecting *which* OpenChamber client (web, desktop, mobile) is attached.
- Making evidence survive an uninstall without a leftover file.
- Changing what host detection *does* (a display concern, see
  `plugin/src/shared/status.js`).

## Decisions

**D1 — Heartbeat + real sessions, version 2.** `{version: 2, heartbeat, sessions}`
in the same file, same folder. The reader takes `heartbeat` as the primary
signal and keeps `sessions` for the per-session line. Alternative rejected: a
separate `host.json` with a timestamp — two files to keep in sync for no gain,
and the existing filename is already documented.

**D2 — Ten minutes, not thirty days.** Long enough to cover the service's own
ten-minute idle stop plus one poll cycle, short enough that an uninstalled
extension is forgotten within a session. The number lives in
`core/host-evidence.js` as `HOST_EVIDENCE_TTL_MS` and is imported by both
consumers through the vendored copies.

**D3 — The heartbeat is written by the maintenance pass and by the answer path.**
The service runs while OpenChamber runs (`keepRunning: true`) and already keeps
a 60 s maintenance clock for the routing sync; the heartbeat rides on it, and an
answer refreshes it too. Alternative rejected: a dedicated timer just for the
heartbeat — same effect, one more loop.

**D3b — Ten minutes covers a paused, crashed or removed extension.** Not "the
section is closed": the service keeps running then.

**D4 — `session-archived` as the cleanup trigger; `/api/session` as the
cross-check.** The event is the timely signal; a periodic
`GET /api/session` diff (on the existing maintenance pass, throttled) catches
what the event missed (extension paused across an archive, a dropped delivery
after backoff). Both only remove ids; nothing is added from the event.

**D5 — Keep the synthetic key out by construction.** The old key existed because
no session id was known before the first turn. A heartbeat removes that need, so
`HOST_EVIDENCE_KEY` is deleted rather than renamed; a test asserts the writer
never emits a key that is not a session id pattern.

**D6 — v1 files are read, never written.** The plugin keeps the v1 branch
(entries without a heartbeat, old 30-day rule) for one release; the writer only
emits v2. Alternative rejected: a hard cut — a user who upgrades the plugin
before the extension would lose detection with no recovery until the extension
updates.

## Risks / Trade-offs

- **A paused or crashed extension** → the heartbeat expires within ten minutes
  and the plugin reports standalone, which is true. Re-enabling the extension
  restores it on the next maintenance pass.
- **Event storms** → one archive per session is cheap; the prune is idempotent.
- **A stale v2 file from a crashed service** → the TTL handles it; no cleanup
  write is needed on start.
- **Two constants in two repos** → eliminated by D2's shared core module and
  `mise run build-core-check` in CI.

## Migration Plan

1. Ship `core/host-evidence.js`, the plugin's v2 reader and v1 fallback in one
   release; verify detection still works against an old extension file.
2. Ship the service writer and the `sessionEvents` declaration next; verify the
   file flips to v2 on the first answer.
3. Rollback: revert the writer; the plugin still reads v1 files and the TTL is
   the only thing that changed.

## Open Questions

- Whether the evidence file should also record the OpenChamber version that
  wrote it. Useful for support, deferrable: the shape already carries a version
  field for the file itself.
