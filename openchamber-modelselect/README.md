# openchamber-modelselect

Work Status section for the modelselect plugin: shows the plugin's
per-session pick (task, tier, model, Jev reason, Go quota, config source)
plus the global on/off/auto mode switch.

Status-only extension: no panel, no background service, no commands.
Vanilla JS IIFE bundle — committed runnable, no build step required.

Requires OpenChamber >= 2.0 (web/desktop only; the status iframe needs
a web view).

## Install

Settings → Extensions → install from Folder / ZIP / URL pointing at
`openchamber-modelselect/`.

Grant the `files` capability when prompted (status + mode files live
under the project; the installed-check reads the two global config
paths declared in `package.json`).

## Update

Bump `version` in `package.json`, then reinstall / update from the same
Folder/ZIP/URL source.

## Layout

- Row 1 (stats): task, tier, model (`provider/id`), `jev` reason,
  Go quota (`Go ok` / `Go out` / `unknown`), config `source`,
  `suggest-only` badge when the plugin runs in trial mode,
  `last known` + dimming when the pick is older than ~10 min
  (skipped auto turns don't rewrite the status file, so stale = last
  applied pick), `Auto` badge while the session model is unset.
- Row 2 (mode): segmented On / Off / Auto control. Writes
  `.opencode/.modelselect-cache/mode.json` via `writeFile` and mirrors
  the value to `host.storage` (`modelselect:mode`).

States: `no-session` (nothing open), `plugin-missing` (no status file
and no `modelselect` entry in the readable global configs — shows the
managed-config fix hint), plus graceful `NOT_GRANTED` / `BAD_PATH`
notes. All state rebuilds on mount: the frame only runs while Work
Status is visible.

## Fix hint (plugin-missing)

Add the plugin to the OpenChamber managed config
`<dataDir>/opencode.managed.json`
(default `~/.config/openchamber/opencode.managed.json`) and reopen
OpenChamber. Global `~/.config/opencode/opencode.json(c)` entries do
not load in the OpenChamber panel.

## Notes

- Task-type names come only from the plugin's
  `model-config-cache.json` (relative read); no model lists are
  hardcoded. Remote fallback for reference:
  `https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json`
- Height: initial 120px, adjusted via `host.setHeight(px)` after every
  render (clamped 24–320).
