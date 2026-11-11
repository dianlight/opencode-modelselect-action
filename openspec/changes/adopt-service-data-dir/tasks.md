# Tasks

## 1. Service data folder

- [ ] 1.1 Read `OPENCHAMBER_SERVICE_DATA_DIR` in `service/src/main.js` (via the
      `@openchamber/sdk` constant) and pass it into `store.js` through a
      `setDataDir` seam; create the folder only on write (`mkdir` recursive), never
      at boot.
- [ ] 1.2 Move the status-section sparkline series (from
      `status-section-polish`) out of the in-memory map, and the last-project
      pointer out of `os.tmpdir()`, into `readings.json` and `latest-project.json`
      under the data folder, keyed by absolute project directory.
- [ ] 1.3 Cap `readings.json` at 120 readings per project and 32 project series,
      evicting the series with the oldest last append.
- [ ] 1.4 Keep project-cache writes strictly for plugin-read data (`status-*.json`,
      `routing-sync.json`, `model-config-cache.json`, `free-quota.json`,
      `usage-limits.json`, `openchamber-sessions.json`).
- [ ] 1.5 Fall back when the variable is absent (older hosts): readings in the
      in-memory map, last-project in the `os.tmpdir()` file with
      `MODELSELECT_STATE_FILE` still taking precedence.
- [ ] 1.6 Document the split in `openchamber-modelselect/README.md` and the service
      tests.

## 2. Verification

- [ ] 2.1 Point `test/helpers/service.cjs` at a fixture
      `OPENCHAMBER_SERVICE_DATA_DIR` instead of `MODELSELECT_STATE_FILE`; assert the
      sparkline survives a service restart and the quota pointer reads back.
- [ ] 2.2 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
- [ ] 2.3 Add a `CHANGELOG.md` entry.
- [ ] 2.4 When `status-section-polish` is archived, amend its "readings collected
      since the restart only" scenario to the persisting behaviour.
