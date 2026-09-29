# openchamber-modelselect

Work Status section for the modelselect plugin: shows the plugin's
per-session pick (task, tier, model, Jev reason, Go quota, config source)
plus the global on/off/auto mode switch.

Status-only extension: no panel, no background service, no commands.
Source is `status/src/main.js` (ESM, imports `connectHost` from
`@openchamber/sdk`); the runnable `status/main.js` is a committed IIFE
bundle built with `bun run build` — never edit it by hand.

Requires OpenChamber >= 2.0 (web/desktop only; the status iframe needs
a web view).

## Install

Settings → Extensions → install from Folder / ZIP / URL pointing at
`openchamber-modelselect/`.

Grant the `files` capability when prompted (status + mode files live
under the project; the installed-check reads the three global config
paths declared in `package.json`, including the OpenChamber managed
config; the routing sync additionally reads
`~/.config/openchamber/modelselect.json` and — only when autoset is
enabled there — reads/writes `settings.json` + `preferences.json`).

## Build and test

```sh
cd openchamber-modelselect
bun install
bun run build   # openchamber-guest-bundle status/src/main.js status/main.js
bun run check   # node --check on the bundle
bun run test    # node --test test/ — frame smoke test (fake guest frame
                # speaking the SDK wire protocol; asserts hello, the
                # per-session pick, the mode switch, and the fix hint)
```

Always rebuild + commit `status/main.js` after editing `status/src/main.js`
(`status/index.html` loads the bundle, not the source).

## Update

Bump `version` in `package.json`, then reinstall / update from the same
Folder/ZIP/URL source.

## Layout

- Header (`ms-head`): `Mode` label + SDK `mountTabs` On / Off / Auto
  control (writes `.opencode/.modelselect-cache/mode.json` via `writeFile`
  and mirrors the value to `host.storage` `modelselect:mode`), with the
  mode hint below (`routes every turn` / `routing paused` /
  `routing synced, plugin off`).
- Status icons: color-coded glyphs trailing the Tier value (Go auth:
  `✓` ok / `✕` out / `?` unknown) and the Model value (`!` while the
  plugin runs in suggest-only trial mode). Native tooltips don't surface
  in the sandboxed frame, so clicking an icon shows the explanation in a
  host toast instead.
- Key list (`ms-grid`): one row per field in Turn-stats style (muted
  label left, right-aligned value) — Task, Agent (live session
  snapshot), Tier, Model (`provider/id`, mono, truncated with `title`
  tooltip), Think (task-type reasoning effort:
  `default`/`minimal`/`low`/`medium`/`high`/`xhigh` from the status file,
  shown capitalized), Jev, Source. Badges (`mountBadge`) carry `last known` +
  dimming when the pick is older than ~10 min
  (`off`/`auto` turns never rewrite the status file, so stale = last
  applied pick), `unlisted task` when the task is absent from the config
  cache, `free exhausted` while the plugin's free-tier soft-error latch
  is fresh (12h for spent quota, 1h for transient rate limiting), and
  `Auto` while the session model is unset.
- Mode-dependent fields: in `auto`/`off` the status file is stale by
  design (the plugin never rewrites it there), so the whole pick grid
  and all badges are hidden — only the live session Model + Agent and
  the mode hint are shown. `on` renders the full grid above. Missing
  mode storage means `auto` (the plugin default): a fresh install shows
  the live grid until the user picks `on`.
- Theme comes from the host (`applyHostReady`); layout CSS uses host
  tokens with system fallbacks, matching other panels.

States: `no-session` (nothing open), `plugin-missing` (no status file
and no `modelselect` entry in the readable global configs — shows the
managed-config fix hint), plus graceful `NOT_GRANTED` / `BAD_PATH`
notes. All state rebuilds on mount: the frame only runs while Work
Status is visible.

## Routing sync

The Jev routing categories (`~/.config/openchamber/routing.json`,
stored-deviations shape) are kept fresh from two places, both best-effort:

- The plugin, before every turn (v2 `prompt` + `context` hooks) — this is
  what makes `auto` mode work: the sync refreshes the categories, then the
  plugin acts like `off` and OpenChamber's routing owns the pick.
- This view, on every Work Status refresh (fallback while the panel is
  open) — grant the `files` capability (the `routing.json` path is
  declared in `package.json`, re-approve on update).

The sync logic is one shared module (`plugin/src/shared/routing.js`);
this bundle wraps it in a host-file adapter
(`status/src/routing-sync.js`).

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
  failures are silent so the view never breaks.
- Free-tier latch: while `.opencode/.modelselect-cache/free-quota.json`
  is fresh (12h for spent quota or 1h for transient rate limiting,
  written by the plugin on a real free-side failure — Zen has no
  free-quota endpoint), the sync forces the `go` side for every category
  and `fallback`, whatever `autoPreference` says; expiry hands the
  choice back.

## External config (`modelselect.json`) + model autoset

`~/.config/openchamber/modelselect.json` (user-editable, all keys
optional) holds the global defaults:

```json
{
  "mode": "auto",
  "autoSmallModel": false,
  "autoWalkthroughModel": false,
  "smallModelTask": "small-model",
  "walkthroughModelTask": "review"
}
```

- `mode` is the fallback when the per-project
  `.opencode/.modelselect-cache/mode.json` is missing or invalid;
  unknown values mean `"auto"`.
- `autoSmallModel: true` writes the resolved `smallModelTask` model
  into `settings.json` + `preferences.json` as `smallModelOverride`
  (with `smallModelUseDefault: false`); `autoWalkthroughModel: true`
  writes the resolved `walkthroughModelTask` model as
  `walkthroughModelOverride` (the Settings → Sessions → Changes
  Walkthrough Model row; the per-panel Walkthrough model picker
  defaults to the small model). Both follow the same go/free
  preference and active free-tier latch window as the categories, write
  only on diff, and never touch `variant`.

## Fix hint (plugin-missing)

Add the plugin to the OpenChamber managed config
`<dataDir>/opencode.managed.json`
(default `~/.config/openchamber/opencode.managed.json`) and reopen
OpenChamber. Global `~/.config/opencode/opencode.json(c)` entries do
not load in the OpenChamber panel.

## Notes

- This view never reads a token itself. `Go ok` / `Go out` / `unknown` and
  the `jev=` reason come from the plugin's own resolution, which reads
  OpenCode's `auth.json` when the server has no `OPENCODE_API_KEY` in its
  environment (always the case here, since OpenChamber spawns its own
  server) — so `unknown` here usually means the plugin found no key at all.
  See `plugin/README.md` (Token resolution).
- Task-type names come only from the plugin's
  `model-config-cache.json` (relative read); no model lists are
  hardcoded. Remote fallback for reference:
  `https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json`
- Height: initial 120px, adjusted via `host.setHeight(px)` after every
  render (clamped 24–320).
