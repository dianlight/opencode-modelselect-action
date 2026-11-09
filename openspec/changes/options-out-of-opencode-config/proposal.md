# Proposal

## Why

Plugin options live inside the OpenCode config entry, so every settings change
is a read-modify-write of `~/.config/openchamber/opencode.managed.json` followed
by a guess: the service tries `OPENCODE_PORT`, `OPENCODE_SERVER_PORT`, `PORT`
and finally 4096 against `POST /api/location/reload`, and falls back to a
"restart OpenChamber" notice when none answers. Three failure modes (wrong
port, endpoint missing, endpoint renamed) become user-visible friction, and the
approval list grows to cover OpenCode's own config files. With the plugin
shipped by the extension (see `ship-plugin-inside-extension`) there is no entry
left to hold options at all — the host lists a bare folder path. The extension
already owns `~/.config/openchamber/modelselect.json` with a documented,
user-editable shape; it can carry the option set too.

## What Changes

- Make `~/.config/openchamber/modelselect.json` the option source for the
  plugin: any key it sets takes precedence over the same key in the config
  entry (`ctx.options`), and the plugin re-reads the file by mtime, per turn.
- The settings panel writes that file only. Saving an option changes the
  plugin's behavior on the next turn with no reload request and no restart
  notice.
- Delete the reload workaround: `RELOAD_PATH`, `reloadPorts()`, `postJson()`,
  `reloadOpenCode()`, the `config-reload` and `tier` control reload answers, and
  the panel's "restart required" copy.
- Migrate once: existing option values from the managed entry are copied into
  `modelselect.json` on first save, and the entry is left untouched for the
  user to remove (handled by the duplicate-entry notice in
  `ship-plugin-inside-extension`).
- Write the file `0600` and keep `token`/`jevToken` write-only through the panel
  as today.
- Keep the service as the only writer: the panel's Plugin tab form does not
  change, only the endpoint behind it.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Capabilities

### New Capabilities

- `plugin-configuration`: where the plugin reads its options, which source wins,
  how a change becomes effective, and how secrets are stored and hidden.

### Modified Capabilities

(none)

## Impact

- `core/` (a small options-source helper shared by plugin and extension, then
  vendored into `plugin/src/shared/core/` and
  `openchamber-modelselect/service/src/` via `mise run build-core`).
- `plugin/src/v2.js` (option resolution), `plugin/src/shared/*`.
- `openchamber-modelselect/service/src/main.js` (control handlers, the `/config`
  save), `panel/src/plugin-tab.js`, `panel/src/fields.js`, rebuilt bundles.
- Tests: plugin option resolution, panel save, service controls.
- Removes code; nothing depends on the reload endpoint afterwards.
