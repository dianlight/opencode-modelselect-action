# Proposal

## Why

The service keeps its own state (the sparkline history the status section
wants, the last project it was asked about, the plugin-presence probe cache)
either in memory, which dies on every restart, or in the project cache, which
belongs to the plugin and is wiped with the project. The host now gives every
service a private folder through `OPENCHAMBER_SERVICE_DATA_DIR`: it survives
restarts and updates, is deleted with the extension, and needs no `filesystem`
capability or path. Using it turns transient in-memory state into durable state
and keeps service-owned data out of the project tree.

## What Changes

- Read `OPENCHAMBER_SERVICE_DATA_DIR` in `openchamber-modelselect/service/src/main.js`
  and pass it into `store.js`; create the folder lazily on first write.
- Move the status-section sparkline history (≤120 readings, from
  `status-section-polish`) and the last-project pointer (used by the quota
  provider) out of in-memory maps and into files under the data folder.
- Keep the project cache strictly for data the plugin reads: `status-*.json`,
  `routing-sync.json`, `model-config-cache.json`, `free-quota.json`,
  `usage-limits.json`, `openchamber-sessions.json`. The service never writes
  service-only state there.
- Fall back gracefully when the variable is absent (older hosts): in-memory
  state, as today.
- Document the split in `openchamber-modelselect/README.md` and the service
  tests.

## Capabilities

### New Capabilities

- `service-data-dir`: which state lives in the service's own folder, how it is
  created and cleaned up, and the degradation on hosts that do not provide it.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, tests.
- Rebuilt `service/main.js`; no manifest change (the variable is provided by
  the host).
- Depends on `sdk-bump-to-2-7-1` for the documented constant.