# Tasks

## 1. Service data folder

- [ ] 1.1 Read `OPENCHAMBER_SERVICE_DATA_DIR` in `service/src/main.js` and pass it into `store.js`; create the folder lazily on first write.
- [ ] 1.2 Move the status-section sparkline history and the last-project pointer out of in-memory maps into files under the data folder.
- [ ] 1.3 Keep project-cache writes strictly for plugin-read data (`status-*.json`, `routing-sync.json`, `model-config-cache.json`, `free-quota.json`, `usage-limits.json`, `openchamber-sessions.json`).
- [ ] 1.4 Fall back to in-memory state when the variable is absent (older hosts).
- [ ] 1.5 Document the split in `openchamber-modelselect/README.md` and the service tests.

## 2. Verification

- [ ] 2.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
- [ ] 2.2 Add a `CHANGELOG.md` entry.
