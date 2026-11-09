# Proposal

## Why

Installing this project on OpenChamber means installing two things that must
match: the OpenCode plugin in a config file, and the extension that reads what
the plugin writes. The extension can only report "the plugin is missing, add it
to `opencode.managed.json` yourself" and the settings panel has to edit that
file on the user's behalf. Canary `2.6.2-canary.20261107.11` adds
`contributes.opencodePlugin`: the extension carries its own plugin folder,
OpenChamber lists it in the config it owns while the extension is enabled, and
disable or uninstall takes it away. One install, one version, one thing to
remove.

## What Changes

- Build the plugin into the extension package as a single self-contained entry
  (`openchamber-modelselect/plugin/index.js`, no imports, `{ id, setup }`
  default export — the shape OpenCode 2 loads) and declare
  `contributes.opencodePlugin: "plugin"`.
- Keep `plugin/` at the repository root as the standalone npm package source;
  the extension copy is a build output, committed like `service/main.js`.
- Stop the settings panel from writing the `modelselect` entry into
  `~/.config/openchamber/opencode.managed.json`. OpenChamber owns that entry
  now, as a bare folder path.
- Detect a leftover manual entry (previous versions wrote `{ package, options }`)
  and offer a one-time removal, because two entries naming the same plugin load
  it twice. The global `opencode.json(c)` entry is the user's and is only
  reported, never edited.
- Replace the "plugin-missing, add it to the managed config" hint (and the
  `needsConfiguration` text on the extension card) with the host's own delivery
  state: loaded, needs `Add to global config`, unavailable on a remote
  OpenCode, or not loadable in an isolated space.
- Keep the service as the only owner of file I/O: it still reads and writes the
  managed config for the legacy entry, so the panel and the approval list do not
  change shape.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Capabilities

### New Capabilities

- `plugin-distribution`: how the modelselect OpenCode plugin reaches OpenCode
  — bundled with the extension, exactly one active entry, removable with the
  extension, and still installable on its own.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (`contributes.opencodePlugin`), new
  `openchamber-modelselect/plugin/` build output.
- Build: a bundle step for the plugin (CJS entry, no external requires), run
  before `openchamber-guest-bundle`; `openchamber-guest-check` then verifies the
  folder and its entry at install.
- `openchamber-modelselect/service/src/main.js` (presence probe),
  `panel/src/plugin-tab.js` (the entry editor loses its save path),
  `panel/src/*` for the removed managed-config form.
- `openchamber-modelselect/README.md`, root `README.md`, `CHANGELOG.md`.
- Depends on `options-out-of-opencode-config`: with no entry to carry `options`,
  the plugin must read its configuration from
  `~/.config/openchamber/modelselect.json`.
- Depends on `sdk-bump-and-release-watch`.
