# Proposal

## Why

The section decides whether the plugin is installed with a regex over readable
config files ("does any of them mention `modelselect`?"). That answer stopped
matching reality: since OpenChamber 2.6.2 a plugin can be switched off in
Settings → Plugins while its config entry stays, and an entry can point at code
that OpenCode failed to load. In both cases the section keeps showing the last
pick as if it were live, and the user has no way to tell a stale project from a
broken install. The cost of being wrong is high: the plugin picks the model, so
a silent dead plugin means every turn runs on the wrong model.

## What Changes

- Replace the boolean "entry found" with an explicit presence state, computed
  from evidence the extension already has: the delivery state OpenChamber
  reports, the age of the newest status file, and — with the `opencode` role —
  whether a session is active without a pick being written.
- States: `running`, `stale`, `not-running`, `not-delivered`, `no-pick`, and the
  transitional `legacy-entry-missing` used only until
  `ship-plugin-inside-extension` lands.
- Move the same verdict into the card text: `needsConfiguration(...)` currently
  asserts "add the plugin to the managed config", which is only one of the
  causes and the wrong one once the extension ships the plugin.
- Never claim `running` without a fresh pick (≤10 minutes, the same threshold
  the `Updated` badge already uses).
- Put one row on screen for a non-running state, with the two plausible causes
  named in order (switched off in Settings → Plugins; plugin failed to load) and
  the exact place to look — never a single wrong attribution.
- Make the `Updated` row carry what proved the state (fresh pick, last pick at
  T, or "no pick since <install time>") so the user can see the evidence, not
  only the verdict.
- Keep the presence probe free of new permissions: no reading of OpenChamber's
  own data folder, no plugin list endpoint.

## Capabilities

### New Capabilities

- `plugin-presence`: which states the extension reports about the plugin, what
  evidence proves each, and how the section and the panel word it.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js` (`pluginEntry()` replaced by a
  presence evaluation, folded into the view), `service/src/view.js` (the
  presence row), service tests.
- `openchamber-modelselect/README.md` (states table), `CHANGELOG.md`.
- Rebuilt `service/main.js`; no manifest or permission change.
- Complements `ship-plugin-inside-extension` (which removes the transitional
  state) and `adopt-opencode-role` (which supplies the session evidence).
