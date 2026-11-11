# Design

## Context

See `proposal.md` — Why. The current state that shapes the approach:

- `service/src/store.js` owns every write and already has the primitives this
  change needs: `writeJsonAtomic` (sibling temp file + rename) and
  `readJsonFile` (lenient, `null` when absent). Nothing in the service writes
  state outside those two paths.
- The last-project pointer is **not** in memory today: `LAST_PROJECT_FILE` is
  `os.tmpdir()/openchamber-modelselect/last-project.json`, overridable through
  `MODELSELECT_STATE_FILE`, which `test/helpers/service.cjs` sets to a fixture
  path so parallel test services do not share it. It survives a restart only by
  accident of the OS temp folder being cleaned on its own schedule.
- The sparkline history does not exist yet: `status-section-polish` (planning
  complete, not implemented) specifies a module-level `Map<cacheDir, number[]>`
  capped at 120 and appended once per answer, and lists "persisting the
  sparkline across restarts" as an explicit non-goal. This change is that
  follow-up: it replaces the map with a file, keeping the same key and cap.
- The host provides `OPENCHAMBER_SERVICE_DATA_DIR` and creates the folder before
  the service starts; it survives restarts and updates and is deleted with the
  extension. `@openchamber/sdk` already exports the constant at the pinned
  version (`2.6.2-canary.20261107.11`), so this change does not wait on
  `sdk-bump-to-canary-20261110` — but the variable is only *set* by hosts new
  enough to implement the data folder, which is why the fallback below matters.
- The service is the extension's only owner of file I/O and the package carries
  no `filesystem` capability: the data folder must be reached through the
  environment, never through a manifest path.

## Goals / Non-Goals

**Goal (recorded for this change):** move the service's own state — the
status-section sparkline history and the last-project pointer — into the host's
per-extension data folder so it survives restarts, and keep the project cache
strictly to data the plugin reads.

**Goals:**

- One seam through which the service learns its own folder, and one write path
  for everything stored there.
- Identical read/write API for callers on hosts with and without the folder, so
  `view.js` and the quota handler never branch on the host version.
- Bounded storage: a folder that lives as long as the extension installed must
  not grow with every project ever opened.

**Non-Goals:**

- The plugin-presence probe cache (`probeCache`, 30 s TTL in `main.js`) stays in
  memory: it is derived on demand from config files, so persisting it would buy
  nothing.
- Migrating the existing `os.tmpdir()` file — it is scratch data, not state
  worth carrying over.
- Changing the plugin's cache layout or the list of files under
  `.opencode/.modelselect-cache/`.
- The sparkline itself (rendering, polling, the 120-point cap): owned by
  `status-section-polish`. This change only changes where the series lives.

## Decisions

**D1 — `main.js` reads the folder, `store.js` holds it.** `main.js` resolves
`process.env[OPENCHAMBER_SERVICE_DATA_DIR]` once at boot (the constant imported
from `@openchamber/sdk`, not a literal) and calls `store.setDataDir(dir)` with
an absolute path or `null`. `store.js` stays free of `process.env` for this
concern, so service tests can point it at a fixture directory directly.
Alternative rejected: reading the variable inside `store.js` — it would make
every store test depend on the ambient environment, and the existing test seam
(`MODELSELECT_STATE_FILE`) already shows the cost of that.

**D2 — Two files, one per concern.**

- `latest-project.json` — `{ version: 1, directory, at }`, the replacement for
  the `os.tmpdir()` file. Rewritten on each `rememberProject`, read by the quota
  handler.
- `readings.json` — `{ version: 1, series: { "<absolute project dir>": number[] } }`,
  each series capped at 120 (same cap as the chart), appended once per answer
  after the quota snapshot is parsed.

Keys are absolute project directories, the same identity `cacheDirOf` derives
from, so a lookup never has to re-resolve the cache path. Alternative rejected:
one file per project (`readings/<hash>.json`) — it adds `readdir` and hashing to
every read for no benefit at this size; a single `state.json` was rejected
because the two writers (per-answer append vs. per-request pointer update) would
rewrite each other's file on every poll.

**D3 — Fallback is per concern, and literal.** With no data folder: readings
live in the module-level map that `status-section-polish` specifies (so the
sparkline works, just not across restarts), and the last-project pointer stays
in `os.tmpdir()/openchamber-modelselect/last-project.json` with
`MODELSELECT_STATE_FILE` still taking precedence. That keeps today's behaviour
on older hosts and keeps the test helper working unchanged. When the folder is
present, `MODELSELECT_STATE_FILE` is ignored — the test helper is updated to pass
`OPENCHAMBER_SERVICE_DATA_DIR` instead, so tests exercise the real path.

**D4 — No eager folder creation.** The host creates the folder; the service does
not `mkdir` at boot, because a host that hands over an unusable path must not
stop the service from answering. `writeJsonAtomic` already does
`mkdir(..., { recursive: true })`, which covers the folder having been deleted
underneath a running service and is a no-op otherwise. The proposal's "create
lazily on first write" is thus satisfied without a new code path.

**D5 — Storage is best-effort, reads never depend on it.** A failed write logs
one line to stderr and the answer still goes out from the in-memory copy; a
corrupt or absent file reads as empty state (`null` / `[]`), which is what the
service already does for the plugin cache. The data folder therefore cannot turn
a working status section into a broken one.

**D6 — Bounded growth by eviction on append.** `readings.json` keeps at most 32
project series; when a 33rd appears, the series with the oldest last append is
dropped. That bounds the file at roughly 32 × 120 numbers (tens of KB) while
covering every project a user realistically has open. Alternative rejected:
time-based expiry — a user who opens one project a month would lose its history
for no storage reason.

**D7 — Write frequency follows the answer, not the request.** The readings
append happens only when a new reading is actually produced (the same condition
`status-section-polish` uses for the map), so a 2 s poll writes at most once per
answer and never on a cached/unchanged answer. `latest-project.json` is written
only when the directory changes from the stored one.

## Risks / Trade-offs

- **Two hosts (or two service instances) writing the same folder** → last write
  wins; `writeJsonAtomic` means a reader never sees a torn document and the
  worst case is a lost reading. Acceptable for trend data.
- **Lost history on an unclean shutdown** → the series is rewritten per append
  with a full-document atomic write, so the last reading before the crash is the
  only one at risk.
- **Old hosts keep a tmpdir pointer** → the pointer still works across restarts
  there, but it is not cleaned with the extension. Documented in the README as
  the degraded path; no migration attempted.
- **Behaviour change against `status-section-polish`** → that change's spec says
  the chart carries "the readings collected since the restart only". With this
  change the series survives a restart, so that scenario needs amending when
  `status-section-polish` is archived. This change declares `skip_specs`, so the
  amendment is recorded here and in the README rather than as a delta spec.
- **`MODELSELECT_STATE_FILE` losing its role** → if the test helper is not
  updated in the same commit, parallel service tests would share one readings
  file. Mitigated by task 2.2, which updates the helper before the tests run.

## Migration Plan

1. Land the store seam and the two files; nothing reads them yet on old hosts.
2. Switch the sparkline source (arriving with `status-section-polish`) and the
   quota pointer to the store API.
3. Rebuild `service/main.js`, update the README split table, add the CHANGELOG
   entry.
4. Rollback: an older bundle simply ignores the folder — the host deletes it
   with the extension, and the only loss is the sparkline history. No user data
   lives there.
