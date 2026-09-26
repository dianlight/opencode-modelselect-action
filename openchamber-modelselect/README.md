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
config).

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
  `routes until you pick a model`).
- Status bar (`ms-statusbar`, on top): icon-only indicators with native
  tooltips — Go auth (`✓` ok / `✕` out / `?` unknown) and `!` when the
  plugin runs in suggest-only trial mode.
- Key grid (`ms-grid`): Task, Tier, Model (`provider/id`, mono, truncated
  with `title`), Jev, Source. Badges (`mountBadge`) carry `last known` +
  dimming when the pick is older than ~10 min
  (skipped auto turns don't rewrite the status file, so stale = last
  applied pick), `unlisted task` when the task is absent from the config
  cache, and `Auto` while the session model is unset.
- Theme comes from the host (`applyHostReady`); layout CSS uses host
  tokens with system fallbacks, matching other panels.

States: `no-session` (nothing open), `plugin-missing` (no status file
and no `modelselect` entry in the readable global configs — shows the
managed-config fix hint), plus graceful `NOT_GRANTED` / `BAD_PATH`
notes. All state rebuilds on mount: the frame only runs while Work
Status is visible.

## Routing sync

On every Work Status refresh the view best-effort syncs OpenChamber's Jev
routing categories (`~/.config/openchamber/routing.json`, stored-deviations
shape) with the plugin task types — grant the `files` capability (the
`routing.json` path is declared in `package.json`, re-approve on update).

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
