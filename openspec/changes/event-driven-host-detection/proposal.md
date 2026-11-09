# Proposal

## Why

"The plugin is running inside OpenChamber" is proven today by a file the
extension writes (`.opencode/.modelselect-cache/openchamber-sessions.json`) that
holds session ids stamped at most once a minute, plus a synthetic `openchamber`
key for projects with no routed session yet, and a 30-day expiry because the
extension lost its `sessions` capability and cannot learn about archived
sessions. Three consequences: an uninstalled extension keeps claiming hosting
for a month, a session archived last week still counts, and the plugin must
carry the same 30-day constant to stay in sync. The canary now delivers
`session-archived` to subscribers reliably, and the `opencode` role can list real
sessions, so the evidence can be a short-lived heartbeat plus real ids instead of
a month-long guess.

## What Changes

- Move the evidence file to a versioned v2 shape:
  `{ version: 2, heartbeat: <ms>, sessions: { <sessionID>: <ms> } }`.
- The service writes a heartbeat on its maintenance pass (its own clock, since
  `service.keepRunning` is true) and on every answer it serves for that project;
  a heartbeat older than 10 minutes means "no extension". Uninstalling is
  therefore noticed in minutes, not weeks.
- Delete the synthetic `openchamber` key: a fresh heartbeat already proves a
  running extension.
- Subscribe to `contributes.sessionEvents: ["session-archived"]` and remove the
  archived session's entry immediately; also prune entries that are no longer
  listed by `GET /api/session` when the `opencode` role is granted.
- Stamp real session ids from `GET /api/session` (directory-filtered) instead of
  scraping `status-*.json`; keep the scrape as the fallback.
- Put the file contract in `core/` (read + write + TTL) and vendor it into the
  plugin and the service, so a single constant decides.
- The plugin reads v1 and v2 (v1 entries keep working during the transition and
  stop counting once the extension writes v2).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Capabilities

### New Capabilities

- `host-detection`: what evidence proves the plugin is running inside
  OpenChamber, how long it lasts, how it is cleaned up, and who writes it.

### Modified Capabilities

(none)

## Impact

- `core/host-evidence.js` (new), `mise run build-core`, vendored copies in
  `plugin/src/shared/core/` and `openchamber-modelselect/service/src/`.
- `plugin/src/shared/host.js` (read v2, TTL 10 min), `plugin/src/v2.js` (call
  sites), `plugin/src/shared/status.js` (the `/modelselect` host line).
- `openchamber-modelselect/package.json` (`contributes.sessionEvents`),
  `service/src/main.js` (heartbeat, archive handler, prune),
  `service/src/store.js`, rebuilt `service/main.js`.
- `openchamber-modelselect/README.md` (session map section), `CHANGELOG.md`.
- Depends on `adopt-opencode-role` for the session listing (the heartbeat works
  without it).
