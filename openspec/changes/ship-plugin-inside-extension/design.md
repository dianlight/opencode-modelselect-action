# Design

## Context

See `proposal.md` — Why. Constraints found in the code and in the host:

- The plugin at `plugin/` is CJS (`module.exports = { id, setup, … }`) and
  `require`s sibling modules, while the host loads an extension's plugin with a
  bare `import()` from the folder — nothing is installed beside it. A direct
  copy therefore cannot work; the entry must be one bundled file.
- `plugin/src/shared/core/*` is the vendored copy of `core/*` (shared with the
  extension and the action); the plugin bundle must fold it in, not resolve it.
- OpenChamber lists the folder as a path entry with **no `options`**: the
  config entry is not a configuration channel any more.
- OpenChamber filters neither list, so the managed entry and a leftover
  `modelselect` entry both load the plugin (checked upstream: a folder listed by
  both lists is loaded once, two *different* entries for the same folder are
  not covered).
- The extension has no `files` capability and no declared filesystem paths: the
  service is the only owner of file I/O, and the panel reaches it through
  `panel/src/api.js`. Reading the managed config to detect a leftover entry is
  the service's existing `/config` read, so it costs nothing new.

## Goals / Non-Goals

**Goals:**

- One artifact to install, one version string, one removal path.
- A plugin build that a machine without `node_modules` can load.
- A migration that cannot silently double-load the plugin.

**Non-Goals:**

- Deleting or rewriting the user's global `opencode.json(c)`.
- Changing routing behavior or the plugin's option set.
- Publishing the bundled entry to npm (the npm package keeps its own `main`).

## Decisions

**D1 — Bundle `plugin/src/v2.js` into one CJS file at build time.** A new
`build:plugin` step (esbuild via `openchamber-guest-bundle`'s toolchain, or a
`bun build --target node` call) writes
`openchamber-modelselect/plugin/index.js`, committed like the other two
bundles. Alternatives rejected: (a) copying `plugin/` as-is — breaks on the
missing siblings; (b) making the plugin a separate npm dependency of the
extension — the host loads a folder, not a package spec, and offline installs
would break.

**D2 — The extension copy is generated, the source stays `plugin/`.** One source
of truth, two outputs (npm package, extension folder). `mise run build-plugin`
regenerates it; a test asserts the bundle's mtime-hash matches a fresh build so
a stale copy fails CI rather than at a user's machine.

**D3 — A one-time migration notice, never an automatic edit.** On the first
answer after upgrade, the service checks the managed config for a `modelselect`
entry whose spec differs from the extension folder. If found, the section shows
a single `note` row plus a `controls` action; the action removes only that
entry from the managed config (already permitted) and reports the result. The
global config is reported, not touched: OpenChamber itself offers
**Add to global config** when it cannot deliver, so a plugin the user owns stays
theirs.

**D4 — Presence comes from the host's delivery state and from the plugin's own
output, not from a config grep.** Delivery is what `GET /api/guests` reports as
`opencodePlugins.delivery`; whether the plugin is *running* is what a fresh
`status-*.json` proves. The old regex over config files
(`pluginEntry()` in `service/src/main.js`) and the `needsConfiguration` card
text are deleted; the states live in `plugin-switched-off-state`.

**D5 — `provides: ["opencodePlugin"]` is not needed.** The capability follows
from `contributes.opencodePlugin`; adding it to `contributes.capabilities` is
refused by the parser. The approval dialog gets the row automatically.

**D6 — Keep `service.entry` and `panel.entry` unchanged.** The plugin ships
beside the existing service and panel in the same package; no new runtime
process is introduced.

## Risks / Trade-offs

- **A stale bundled plugin** ships old routing code → the hash test in D2 and
  the existing "rebuild always" rule.
- **Double load for users who keep the old entry** → D3's notice; the plugin
  would otherwise register its hooks twice (routing twice per turn).
- **Enterprise mode refuses the plugin** like a local service → the section
  states it; nothing else changes.
- **The plugin folder inside the package grows the install** by ~100 KB →
  accepted, it replaces a second install.
- **A plugin bug becomes an extension bug** → one version, one rollback; the
  section still reads caches if the plugin dies.

## Migration Plan

1. Land the bundle step and the manifest key; verify a clean install loads the
   plugin with the hand-written entry removed.
2. Ship the migration notice in the same release, so upgrades are covered.
3. Rollback: remove `opencodePlugin` from the manifest; the package installs as
   before and the old entry (if still present) takes over again.

## Open Questions

- Whether the extension should also offer "add to global config" itself when
  OpenChamber reports `delivery: "none"`, instead of deferring to the host's
  own button. Deferrable; the host's button is the contract.
