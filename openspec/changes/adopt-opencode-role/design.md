# Design

## Context

See `proposal.md` — Why. Constraints found in the code:

- `service/src/main.js` builds every answer in `readView()` from
  `store.listStatuses(cacheDir)`, parses `status-*.json`, and throttles a
  session-map write at 60 s. Every `/status` call costs a `readdir` plus N file
  reads.
- `service/src/view.js` is a pure function from parsed state to the rows
  answer, and is unit-tested that way — worth keeping pure.
- The service is bundled with `openchamber-guest-bundle --node`; adding
  `@opencode/client` would put a dependency (and an update path) inside the
  bundle for six documented `fetch` calls.
- The status source contract sends only `directory` and `locale`. A session id
  still never reaches the section; the role closes the gap on project-level
  facts, not on "which session the user is looking at".
- `GUEST_REQUEST_RESPONSE_MAX` bounds each response, the event stream included,
  so a long subscription has to reconnect.

## Goals / Non-Goals

**Goals:**

- One connection, one snapshot, answers that cost no disk work while the
  section is visible.
- Session identity and activity that comes from OpenCode, not from files this
  project writes.
- A visible, honest difference between "live from the host" and "from the
  project cache".
- Keep the service dependency-free and the view function pure.

**Non-Goals:**

- Session-scoped picks in the section (no session id in the contract).
- Any write through the role: routing reload is removed by
  `options-out-of-opencode-config`, not re-implemented here.
- Reading message content. The service never needs it; the approval text says
  the role *can* read it, and the code still must not.

## Decisions

**D1 — Plain `fetch`, no `@opencode/client`.** Six routes with a bearer header
fit in one small client module; a dependency would need bundling, version
tracking and would silently widen the installed surface. Alternative rejected:
importing the SDK client (typed, but pulls its transport and update cadence
into a bundle the host never compiles).

**D2 — Snapshot object, updated by the stream, read by `readView()`.** The
snapshot holds sessions (id, title, directory, busy, model, agent), the active
id set, the last event timestamp and the connection state. `/status` reads it
synchronously; the stream writer and the answer reader are separate so a broken
stream cannot block an answer.

**D3 — SSE with a single reconnecting subscriber.** Start on the first answer
that finds the section shown, stop after five minutes without a `/status` or
`/quota` call (the host stops polling when the section is folded), reconnect
with capped exponential backoff (1 s → 30 s), and reconnect immediately on a
clean end. Alternative rejected: polling `/api/session/active` every 5 s — it
is the same traffic the files already cost, without the events.

**D4 — Files remain the routed-pick source.** `status-*.json` is written by the
plugin with the pick and its lineage; OpenCode knows nothing about it. The
snapshot therefore never replaces `listStatuses()`, it replaces only the
session-identity and activity parts; the fallback path is the current code
unchanged.

**D5 — Filter sessions by the project directory.** `/api/session` is asked with
the directory the request carried, exactly like the current file scan is scoped
to `cacheDirOf(directory)`; no cross-project leakage into a project's answer.
When the filter is unavailable, keep the newest status-file session only.

**D6 — Report provenance in the existing rows, not a new row.** The
`Updated` row tooltip names `host stream` or `project files`; no extra row is
spent (see `status-section-polish` for the row budget).

## Risks / Trade-offs

- **A new approval for every existing user** → the update re-asks once; the
  section keeps working from files if the user declines (D4), so refusing is
  not a broken install.
- **Stream churn on a busy machine** → byte cap and backoff; the stream is off
  when the section is closed.
- **Silent divergence between snapshot and files** → the `Updated` tooltip
  names the source and its age; tests pin both paths to the same view shape.
- **A host that moves OpenCode under the service** (restart, relay switch) →
  the stream ends without a notice; reconnection follows the new server, and
  one answer may be stale. Documented, not worked around.

## Migration Plan

1. Ship the manifest change and the new client together; without the grant the
   service behaves exactly as today.
2. Bump `engines.openchamber` to the canary build that carries the role once
   the release is cut, and keep the file path for hosts below it.
3. Rollback: remove `"opencode"` from `provides`; the fallback is unchanged
   code, so a revert is a version bump, not a migration.

## Open Questions

- Whether `/api/session/active` should drive the "busy" badge instead of the
  event stream's status events. Deferrable, both are in the snapshot.
