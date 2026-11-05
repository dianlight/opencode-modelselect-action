# openchamber-modelselect

Work Status section for the modelselect plugin: the host draws the plugin's
newest pick in the project (task, tier, model, Think effort, Jev reason, Go
quota, config source) plus the auto-update-router switch, and a settings
panel edits the plugin + extension config.

The status section is **host-rendered** (`contributes.statusSection.source`,
OpenChamber >= 2.6.1) — no iframe. A local service (`service/src/main.js`,
bundled to `service/main.js`) is spawned by the host, answers `GET /status`
on the loopback port while the section is shown, and takes the controls'
`POST`s on the same path. The settings panel is still a guest page
(`panel/src/main.js` → `panel/main.js`, committed IIFE); never edit the
bundles by hand.

Requires OpenChamber >= 2.6.1 (web/desktop). The source contract sends only
`?directory=` and `?locale=` — no session id — so the section is
project-scoped: it shows the newest `status-*.json` in the open project,
not the session the user is looking at. The live session model/agent rows
of the old iframe are gone with it.

The session map the service writes is what lets the plugin detect
OpenChamber hosting even for sessions driven from the mobile app (which
loads no extensions — same server, same project).

## Install

Settings → Extensions → install from Folder / ZIP / URL pointing at
`openchamber-modelselect/`.

Approve the request list once. It holds:

- the **local service** — the status section's reader and router switch.
  It runs with your own user access (no OS sandbox) and needs no `exec` or
  `socket` permission. Until it is approved the host answers `NO_SERVICE`
  and the section body stays empty.
- the `files` capability — the settings panel's read/write of the managed
  OpenCode config and `~/.config/openchamber/modelselect.json` (paths
  declared in `package.json`; re-approve after adding a path).

## Build and test

```sh
cd openchamber-modelselect
bun install
bun run build   # service/ as a Node (--node) bundle, panel/ as an IIFE
bun run check   # node --check on both bundles
bun run test    # node --test test/ — view schema, live service, manifest,
                # panel frame
```

Always rebuild + commit both bundles after editing a source file. The
extension never compiles TypeScript on the host, so a stale bundle ships
stale code.

## Update

Bump `version` in `package.json`, then reinstall / update from the same
Folder/ZIP/URL source.

## Status section (host-rendered)

The host asks the service for an answer and draws it itself; colours are
theme tones, never CSS, and the answer must match
`guestStatusViewSchema` or the whole section is refused. Rows, in order:

- `Task` — status-file task type, `unlisted task` warning badge when it is
  absent from `model-config-cache.json`;
- `Tier` — the picked tier, with a status dot from the last Go probe
  (success = OK, error = exhausted, muted = unknown) and the explanation in
  its tooltip;
- `Model` — `provider/id`; `suggest only` info badge (and tooltip) while
  the plugin runs in trial mode;
- `Think` — effective effort (`High`, `Low (manual, task High)`);
- `Jev`, `Source`;
- `Updated` — the pick's age (`just now`, `4m ago`), `last known` warning
  badge past ~10 min, session id + timestamp in the tooltip;
- `Go monthly` — a bar from the plugin's `usage-limits.json` snapshot
  (width = consumed percent, tone by limited/thresholds, resets in the
  tooltip); hidden without usable data;
- one `note` per fresh free-tier latch (`Free tier exhausted — <model> —
  retry in 2h 15m · <detail>`, `Rate limited` for the 1h window), the
  countdown recomputed on every poll;
- `Auto-update router` — a segmented On / Off control (see below), always
  the last row so it survives the 16-row cap.

Polling is the manifest's `source.interval` (2 s) and runs only while the
section is shown and expanded; the host sizes the section to its rows, so
there is no `setHeight`. The old per-session split (full pick grid only for
auto/virtual sessions) is gone: with no session in the contract, whichever
pick is newest is shown, and the router switch gates only the `routing.json`
refresh.

States: `no-project` (nothing open), `plugin-missing` (no status file and
no `modelselect` entry in the readable global configs — shows the
managed-config fix hint), `no-pick` (plugin installed, no routed turn yet).

## Routing sync

The Jev routing categories (`~/.config/openchamber/routing.json`,
stored-deviations shape) are kept fresh from two places, both best-effort:

- The plugin, before every turn (the `prompt` + `context` hooks) while
  the router sync is ON — a courtesy sync so an installed OpenChamber
  follows the plugin's caches; the plugin routes the pick itself (only
  virtual `modelselect/auto-*` sessions) and never hands off to OpenChamber's
  routing.
- This service, while the Work Status section is visible — at most once
  every 30 s, and immediately when the switch is turned back on. Without
  the section being opened the plugin's per-turn sync is the only writer.

The switch row (`Auto-update router`, On / Off) writes
`.opencode/.modelselect-cache/routing-sync.json`
`{"sync": true|false}`; a missing/unreadable/non-boolean file means ON.
The settings panel's Extension tab toggles the same file.

The sync logic is the shared, dependency-free core (`core/routing.js` at
the repo root); the service wraps it in a plain-fs adapter
(`service/src/main.js`).

- Source: plugin `task-types-cache.json` (`jev_criteria` + `agent`) plus
  `model-config-cache.json` (`go`/`free` per task type).
- `autoPreference` from the modelselect plugin options in the managed/global
  OpenCode config picks the `go` (`go-first`) or `free` (`free-first`,
  default) side for every category and for `fallback` (which follows
  `generic`). Missing `autoPreference` means `free-first`.
- Category `description` is the `jev_criteria` verbatim (what Jev reads).
  Empty criteria are ignored: never created, disabled when already present.
- `agent` is written only when the task type defines one, otherwise the
  user's value is left alone. `variant` is never touched.
- Stale entries (stored ids that are no task type) are disabled
  (`disabled: true`), never deleted. Writes happen only on diff; all
  failures are silent so the section never breaks.
- Free-tier latch (per model): while `.opencode/.modelselect-cache/free-quota.json`
  carries a fresh entry for a model (12h for spent quota or 1h for
  transient rate limiting, written by the plugin on a real free-side
  failure — Zen has no free-quota endpoint), the sync forces the `go`
  side for that model's categories and `fallback`, whatever
  `autoPreference` says; every other category keeps its preference, and
  expiry hands the choice back. A legacy model-less entry still forces
  every category. The section renders one countdown note per fresh entry.

## Session map (host detection)

The service is the **sole writer** of
`.opencode/.modelselect-cache/openchamber-sessions.json`
(`{version:1, sessions:{<sessionID>: lastSeenEpochMs}}`), the evidence
file the plugin reads to detect OpenChamber hosting (see
`plugin/README.md`, Host detection). Behavior:

- every poll (throttled to one write per 60 s) stamps each session id it
  finds in the project's `status-*.json` files, so a previously routed
  session counts as evidence;
- before the first routed turn there is no session id to stamp, so it uses
  the synthetic key `openchamber` — the plugin's setup probe reads any
  fresh entry, so a fresh project is still detected;
- every write age-prunes entries older than 30 days (same window as the
  plugin read — keep `SESSION_MAP_TTL_MS` in sync with
  `plugin/src/shared/host.js`);
- with no workspace subscription, archived/deleted sessions are cleaned up
  by that 30-day prune instead of immediately (the `sessions` capability
  is gone);
- writes go through a temp file + rename and never throw.

The plugin only ever reads this file. A session that has never routed has
no entry, so the plugin's per-session `/modelselect` line can report
`standalone` until its first turn even while project-level detection is
already on.

## External config (`modelselect.json`) + model autoset

`~/.config/openchamber/modelselect.json` (user-editable, all keys
optional) holds the global defaults (the `mode` key is gone — the
virtual `modelselect/auto-*` models are the routing switch now):

```json
{
  "autoSmallModel": false,
  "autoWalkthroughModel": false,
  "smallModelTask": "small-model",
  "walkthroughModelTask": "review"
}
```
- `autoSmallModel: true` writes the resolved `smallModelTask` model
  into `settings.json` + `preferences.json` as `smallModelOverride`
  (with `smallModelUseDefault: false`); `autoWalkthroughModel: true`
  writes the resolved `walkthroughModelTask` model as
  `walkthroughModelOverride` (the Settings → Sessions → Changes
  Walkthrough Model row; the per-panel Walkthrough model picker
  defaults to the small model). Both follow the same go/free
  preference and active free-tier latch window as the categories, write
  only on diff, and never touch `variant`.

## Settings panel

The `Model select` rail icon (`panel/index.html` → `panel/main.js`) opens
a two-tab settings panel (same `files` capability, no new paths beyond
what is already declared in `package.json`):

- **Plugin tab** — the modelselect entry's `options` inside the OpenChamber
  managed OpenCode config (`~/.config/openchamber/opencode.managed.json`,
  the only OpenCode config OpenChamber's own server loads). Covers tier,
  autoPreference, taskType, defaultTaskType, announce, the OpenChamber
  host force, the maxCost slider (0 … catalog max, rightmost = No limit,
  with tick labels for the catalog min/max blended cost from the plugin's
  `model-config-cache.json`), verbose / suggestOnly / continuation,
  historyChars, configRefreshMinutes, the Jev fields, configUrl,
  taskTypesUrl, fallbackModel, agentTaskMap (JSON), and the write-only
  `token` / `jevToken` password fields (blank = keep the stored value,
  never rendered). Save is read-modify-write: unknown option keys and
  unknown top-level config keys are preserved, and the Save button stays
  disabled until something actually changed (secret drafts count as a
  change; after a successful save the drafts clear and the button gates
  again). String / tuple entries are
  converted to `{ package, options }` in place. A missing entry shows an
  "Add to managed config" button that disappears once the entry exists
  (re-clicking cannot duplicate it). An unparseable config shows an error
  banner and no form — nothing is ever written over it. After a
  successful save, a "restart required" warning banner asks to quit and
  reopen OpenChamber so its server reloads the plugin options (no
  programmatic reload exists: the SDK exposes no server/config reload
  call, and a raw file write bypasses the Settings-save path that
  restarts the managed server — so this is a manual-reopen notice, not
  a confirm-then-reload flow).
- **Extension tab** — the router-sync switch (project
  `.opencode/.modelselect-cache/routing-sync.json`, same file the status
  section toggles) plus `~/.config/openchamber/modelselect.json`
  (`autoSmallModel`, `autoWalkthroughModel`, `smallModelTask`,
  `walkthroughModelTask`; created on first save, unknown keys preserved).
  Applies on the next turn — no restart.
- **Models tab** (read-only preview) — a task combo plus the model chain
  for that task in the order the saved configuration would use it:
  effective side first (pinned tier, else the auto preference with
  free-quota failover), each side score-best-first. Rows show the model
  name, provider, context window (`200k ctx`, before the score), score,
  blended + in/out costs, themed media icons top-right (file-text, image,
  file-pdf, audio, video, attachment; unknown modalities render as their
  name), each with a tooltip + click-to-toast description, and a
  usage-status bar (Go rows: the consumed monthly quota window from the
  plugin's `usage-limits.json` snapshot — width = percent, tone by
  limited/thresholds; free rows: availability — full unless latched;
  excluded rows: the blocking reason at full width); cost stays as text
  in the meta line, never in the bar. Excluded rows
  are grayed with the reason (`quota latched · retry in …`,
  `over maxCost $…`, `off-side · …`, `no cost data`). The pick gets a
  PICK badge. The task combo sits inline with a themed eye / eye-off button
  that hides/shows the excluded rows. Live Go monthly usage comes from the
  plugin's `usage-limits.json` snapshot (written Node-side from
  `GET /api/experimental/usage/limits` with a Zen fallback, never holding
  a token in the panel). The chain mirrors
  `plugin/src/shared/select.js` without the live network probe, reusing
  the shared core (`lookup`, `model-ref`, `budget`, `free-quota`) via
  `panel/src/models.js`. Capability data comes from the catalog rows
  (`context` + `modalities`, enriched by maintenance from the curated
  `config/model-capabilities.yaml` table + the models.dev registry;
  rows without data omit the ctx segment and icons, and the pane says
  so outright: when no row carries capability data it shows how to
  refresh the plugin cache).

  The shell renders once: later host `ready` snapshots (pushed while a
  session runs) only refresh the theme, so the active tab and unsaved
  edits survive. Reopen the panel to reload from disk after switching
  projects.

`test/panel-frame.test.cjs` asserts hello, the seeded form values, the
merge-preserving save, the blank-secret behavior, the missing-entry and
unparseable-config states, and the extension-tab writes.

## Fix hint (plugin-missing)

Add the plugin to the OpenChamber managed config
`<dataDir>/opencode.managed.json`
(default `~/.config/openchamber/opencode.managed.json`) and reopen
OpenChamber. Global `~/.config/opencode/opencode.json(c)` entries do
not load in the OpenChamber panel.

## Notes

- The section never reads a token itself. `Go ok` / `Go out` / `unknown`
  and the `jev=` reason come from the plugin's own resolution, which reads
  OpenCode's `auth.json` when the server has no `OPENCODE_API_KEY` in its
  environment (always the case here, since OpenChamber spawns its own
  server) — so `unknown` here usually means the plugin found no key at all.
  See `plugin/README.md` (Token resolution).
- Task-type names come only from the plugin's
  `model-config-cache.json` (no model lists are hardcoded). Remote
  fallback for reference:
  `https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json`
- The service is loopback-only and every request must carry the host's
  `Authorization: Bearer $OPENCHAMBER_SERVICE_TOKEN`; it binds
  `127.0.0.1:$OPENCHAMBER_SERVICE_PORT` and copies no host secrets from
  its environment.
- No height management: the host sizes the section to its rows (16 max).
