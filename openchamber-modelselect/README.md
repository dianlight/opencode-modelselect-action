# openchamber-modelselect

Work Status section for the modelselect plugin: the host draws the plugin's
newest pick in the project (task, tier, model, Think effort, Jev reason, Go
quota) plus the auto-update-router switch. A settings panel edits the plugin
and extension config, and a session action shows the pick of the session it was
run on.

The status section is **host-rendered** (`contributes.statusSection.source`) —
no iframe. One local service (`service/src/main.js`, bundled to
`service/main.js`) is spawned by the host and is the extension's **only owner
of file I/O**:

| Path | Who calls it |
|---|---|
| `GET /status` | the host, while the section is shown (2 s) |
| `POST /status` | the section's controls: `routing-sync`, `tier`, `config-reload` |
| `GET/POST /config` | the settings panel: one snapshot, then saves |
| `GET /chain` | the settings panel's Models tab |
| `GET /pick` | the background session action |
| `POST /quota` | OpenChamber's Usage page |
| `POST /session-events` | OpenChamber: the agent's permission requests and forms |

The panel therefore declares no `files` capability and no filesystem paths; it
is presentation only (`panel/src/main.js` shell, `plugin-tab.js`,
`ext-tab.js`, `models-tab.js`, `fields.js`, `api.js`, `dom.js`). Never edit the
bundles by hand.

Requires OpenChamber >= 2.7.1 (web/desktop; the `sessionControl.answers` grant
and the session events the service subscribes to land in 2.7.1). The source
contract sends only `?directory=` and `?locale=` — no session id — so
the section is project-scoped: it shows the newest `status-*.json` in the open
project. The session action is the session-scoped view.

The session map the service writes is what lets the plugin detect OpenChamber
hosting even for sessions driven from the mobile app (which loads no
extensions — same server, same project).

## Install

Settings → Extensions → install from Folder / ZIP / URL pointing at
`openchamber-modelselect/`, then approve the request list once. It holds:

- the **local service** — the status section's reader, the panel's config
  store and the router switch. It runs with your own user access (no OS
  sandbox) and needs no `exec` or `socket` permission. Until it is approved the
  host answers `NO_SERVICE`, the section body stays empty and the panel shows
  how to allow it. `keepRunning` means OpenChamber starts it with the app and
  brings it back if it stops: the routing sync and the host-detection map then
  stay fresh without a panel being open, which is what the approval line says.
- the **usage provider** role (`quota`) — the card on Settings → Usage.
- the **session control** grant (`sessionControl`) — the service acts on
  sessions on its own; it uses it to send a message to a session.
- the **session answers** grant (`sessionAnswers`) — the service answers the
  agent's permission requests and forms for you, in the project you have open.
  Every answer is for that one request: an "always allow" rule stays a click
  in the app.
- the **session events** the service subscribes to (`permission-asked` and
  `question-asked`, with their content) — the permission's detail and the
  form's fields. Nothing else of the conversation is read.

Folder installs do not update themselves; a git-installable distribution (with
OpenChamber's Update button) is specified in
`openspec/changes/git-installable-extension/`.

## Build and test

```sh
cd openchamber-modelselect
bun install
bun run build   # service/ (Node bundle), panel/ and background/ (IIFE)
bun run check   # node --check on all three + openchamber-guest-check
bun run test    # node --test test/
```

Always rebuild + commit all three bundles after editing a source file. The
extension never compiles TypeScript on the host, so a stale bundle ships stale
code; CI fails on a bundle that does not match its source.

The SDK is pinned to `@openchamber/sdk` `2.7.1` — the first stable release that
carries the `sessionControl.answers` grant and the session events the service
subscribes to, so the extension needs no canary host. A bump means: change the
pin in `package.json`, run the four commands above, and commit the three
rebuilt bundles with it.

Tests: `status-view` (the host schema, every row state), `chain` (the models
preview), `status-service` (the real bundle over HTTP: status, controls,
config read/write, chain, pick, quota), `panel-frame` (the panel bundle in a
fake guest frame, with every `serviceRequest` forwarded to the real service),
`manifest`, `answers` (the values a form is answered with), `session-answers`
(the real bundle answering the agent's requests against a fake host).

## Update

Bump `version` in `package.json`, then reinstall / update from the same
Folder/ZIP/URL source.

## Status section (host-rendered)

The host asks the service for an answer and draws it itself; colours are theme
tones, never CSS, and the answer must match `guestStatusViewSchema` or the
whole section is refused. `requiresProject` hides the section when nothing is
open. Rows, in order:

- `Task` — status-file task type, `unlisted task` warning badge when it is
  absent from `model-config-cache.json`;
- `Tier` — the picked tier, with a status dot from the last Go probe
  (success = OK, error = exhausted, muted = unknown) and the explanation in its
  tooltip. When the managed config has a modelselect entry the row carries a
  `select` (auto / go / free) that writes the plugin option and reloads
  OpenCode, so the tier changes without opening the panel;
- `Model` — `provider/id`; `suggest only` info badge (and tooltip) while the
  plugin runs in trial mode;
- `Think` — effective effort (`High`, `Low (manual, task High)`);
- `Jev`, `Source`;
- `Updated` — the pick's age (`just now`, `4m ago`), `last known` warning
  badge past ~10 min, session id + timestamp in the tooltip;
- `Go monthly` — a bar from the plugin's `usage-limits.json` snapshot
  (width = consumed percent, tone by limited/thresholds, resets in the
  tooltip); hidden without usable data;
- one line per model under each Console budget (`<budget> — <model>`:
  `$spent / $limit`, progress bar tone by consumed percent, reset in the
  tooltip); hidden when the snapshot has no budget model data;
- one `note` per fresh free-tier latch (`Free tier exhausted — <model> —
  retry in 2h 15m · <detail>`, `Rate limited` for the 1h window), the
  countdown recomputed on every poll;
- `Auto-update router` — a segmented On / Off control, always the last row so
  it survives the 16-row cap.

States: `plugin-missing` (no readable modelselect entry in the managed config
— one short row; the full fix is on the extension card, see below),
`no-pick` (plugin installed, no routed turn yet).

## Where the fix text lives

The service calls `createServiceHost().needsConfiguration(message)` once per
state change, so OpenChamber shows "Add the modelselect plugin to
`<dataDir>/opencode.managed.json` and reopen OpenChamber" on the extension's
card instead of inside a row of the section. Global
`~/.config/opencode/opencode.json(c)` entries do not load in OpenChamber's
panel; the managed config is the only one its server reads.

## Routing sync

The Jev routing categories (`~/.config/openchamber/routing.json`,
stored-deviations shape) are kept fresh from two places, both best-effort:

- The plugin, before every turn (the `prompt` + `context` hooks) while
  the router sync is ON — the plugin routes the pick itself (only virtual
  `modelselect/auto-*` sessions) and never hands off to OpenChamber's routing.
- This service, on its own clock (`keepRunning`): at most once every 30 s per
  project, immediately when the switch is turned back on, and right after the
  panel saves plugin options. A read of `/status` never writes it.

The switch row (`Auto-update router`, On / Off) writes
`.opencode/.modelselect-cache/routing-sync.json`
`{"sync": true|false}`; a missing/unreadable/non-boolean file means ON.
The settings panel's Extension tab toggles the same file through the service.

The sync logic is the shared, dependency-free core (`core/routing.js` at
the repo root); the service wraps it in a plain-fs adapter (`store.js`).

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

- every status read stamps each session id it finds in the project's
  `status-*.json` files (throttled to one write per 60 s), so a previously
  routed session counts as evidence — this is the only write a read performs,
  and it is the service's own file, never the project's routing config;
- before the first routed turn there is no session id to stamp, so it uses
  the synthetic key `openchamber` — the plugin's setup probe reads any
  fresh entry, so a fresh project is still detected;
- every write age-prunes entries older than 30 days (same window as the
  plugin read — keep `SESSION_MAP_TTL_MS` in sync with
  `plugin/src/shared/host.js`);
- with no workspace subscription, archived/deleted sessions are cleaned up
  by that 30-day prune instead of immediately;
- writes go through a temp file + rename and never throw.

The plugin only ever reads this file. A session that has never routed has
no entry, so the plugin's per-session `/modelselect` line can report
`standalone` until its first turn even while project-level detection is
already on.

## Answers (session control)

`contributes.sessionControl: { answers: true }` puts the `sessionAnswers` line
in the approval dialog: the service may answer the agent's permission
requests and forms for you. OpenChamber posts every `permission-asked` and
`question-asked` event to `POST /session-events`, and the service answers:

- a **permission** is allowed once, with a message that says the extension
  allowed it. An answer is for that request only — nothing the service does
  creates a standing rule, so "always allow" stays a click in the app;
- a **form** is answered with the values the service already holds: the
  session's project directory, and the plugin's pick for that session (model,
  task type, tier). Every other field keeps its default, and a field whose
  `when` conditions do not hold is not filled at all;
- a **page** is never answered — a page cannot be answered from a service — so
  it is sent to the session, which closes it as when you write in the chat.

Only the project the extension was asked about is answered (the section
polled it, or the panel named it). A request in any other project is left
alone.

A request that settled meanwhile — you answered it in the app, or on another
device — comes back as a 404. The service logs that and moves on: it never
repeats an answer for a request that no longer exists.

## Session action

`contributes.actions` adds **Model select pick** to a session's menu. It runs
in the background entry (`background/main.js`, no UI): `GET /pick?session=…`
returns the one-line summary (`bugfix · free · opencode/zen-free · High ·
5m ago`, with `last known` past ~10 min) and the frame shows it as a toast with
Copy. Without a routed turn the toast says the session routes on its first
turn.

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

## Usage provider (quota)

The service declares `provides: ["quota"]` with an empty `providers` list
(no credentials are consumed). OpenChamber names it `ext-model-select` and
lists it on the Usage page. The service answers `POST /quota`
(`usage.read`) from the plugin's `usage-limits.json` snapshot:

- `windows` — Go rolling / weekly / monthly meters (`usedPercent`, `resetAt`)
- `models` — per-model Console budget windows (`providerID/modelID` →
  `usedPercent`, `resetAt` from `budgets[].models[]`)

The quota call carries no project, so the service answers with the project it
was last asked about (the section or the panel) and says "open a project so the
plugin writes one" when it has none. (The host spawns a service with the
extension folder as its working directory, so reading `process.cwd()` — what
0.7.0 did — can never find a project cache.)

## Settings panel

The `Model select` rail icon (`panel/index.html` → `panel/main.js`) opens a
three-tab settings panel. It reads one `GET /config` snapshot on open and
writes through the service, so it needs no file grants of its own:

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
  never rendered and never returned by `/config`). Save is read-modify-write
  inside the service: unknown option keys and unknown top-level config keys
  are preserved, and the Save button stays disabled until something actually
  changed (secret drafts count as a change; after a successful save the
  drafts clear and the button gates again). String / tuple entries are
  converted to `{ package, options }` in place. A missing entry shows an
  "Add to managed config" button that writes a bare entry and reloads the
  panel. An unparseable config shows an error banner and no form — nothing
  is ever written over it. After a successful save the service reloads
  OpenCode's configuration (`POST /api/location/reload`, OpenCode >= 2.2.1)
  so the new options apply without restarting OpenChamber; if the reload
  endpoint is unavailable the familiar "restart required" notice is shown
  instead.
- **Extension tab** — the router-sync switch (project
  `.opencode/.modelselect-cache/routing-sync.json`, same file the status
  section toggles) plus `~/.config/openchamber/modelselect.json`
  (`autoSmallModel`, `autoWalkthroughModel`, `smallModelTask`,
  `walkthroughModelTask`; created on first save, unknown keys preserved).
  Applies on the next turn — no restart.
- **Models tab** (read-only preview) — a task combo plus the model chain
  `GET /chain` returns for that task, in the order the saved configuration
  would use it: effective side first (pinned tier, else the auto preference
  with free-quota failover), each side score-best-first. Rows show the model
  name, provider, context window (`200k ctx`, before the score), score,
  blended + in/out costs, themed media icons top-right (file-text, image,
  file-pdf, audio, video, attachment; unknown modalities render as their
  name), each with a tooltip + click-to-toast description, and a
  usage-status bar computed by the service (Go rows: the consumed monthly
  quota window from the plugin's `usage-limits.json` snapshot — width =
  percent, tone by limited/thresholds; free rows: availability — full unless
  latched; excluded rows: the blocking reason at full width); cost stays as
  text in the meta line, never in the bar. Excluded rows
  are grayed with the reason (`quota latched · retry in …`,
  `over maxCost $…`, `off-side · …`, `no cost data`). The pick gets a
  PICK badge. The task combo sits inline with a themed eye / eye-off button
  that hides/shows the excluded rows. The chain mirrors
  `plugin/src/shared/select.js` without the live network probe, reusing the
  shared core (`lookup`, `model-ref`, `budget`, `free-quota`) via
  `service/src/chain.js`. Capability data comes from the catalog rows
  (`context` + `modalities`, enriched by maintenance from the curated
  `config/model-capabilities.yaml` table + the models.dev registry;
  rows without data omit the ctx segment and icons, and the pane says
  so outright: when no row carries capability data it shows how to
  refresh the plugin cache).

  The shell renders once: later host `ready` snapshots (pushed while a
  session runs) only refresh the theme, so the active tab and unsaved
  edits survive. Reopen the panel to reload from disk after switching
  projects.

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
