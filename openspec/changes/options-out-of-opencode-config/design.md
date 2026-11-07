# Design

## Context

See `proposal.md` — Why. Constraints found in the code:

- `plugin/src/v2.js` resolves options from `ctx.options` only
  (`normalizeOptions(ctx.options ?? {}, process.env)`), and
  `plugin/src/shared/status.js` already documents that the old `mode` key of
  `~/.config/openchamber/modelselect.json` is gone — the file is read today by
  `core/routing.js` for `autoSmallModel` / `autoWalkthroughModel` only.
- The extension's `service/src/store.js` exposes `MODELSELECT_CONFIG_PATH` and
  the panel's Extension tab already read-modify-writes that file, preserving
  unknown keys — the writer half exists.
- `service/src/main.js` holds the whole reload workaround in ~35 lines plus two
  control branches and the panel's toast copy; removing it is a deletion, not a
  refactor.
- The plugin must keep working when installed from npm and configured only
  through `opencode.json`; hence "the file wins where it speaks", never "the
  file replaces the entry".

## Goals / Non-Goals

**Goals:**

- One editable file, one precedence rule, no network call to apply a change.
- The panel and the plugin agree without a cache-invalidation protocol.
- Secrets in a file whose defaults are already user-private.

**Non-Goals:**

- Per-project option files (the plugin runs one process per OpenCode, not per
  project).
- Editing the plugin entry's `options` from the panel.
- Applying a change mid-turn.

## Decisions

**D1 — Precedence: file keys win over `ctx.options`.** The panel writes exactly
the keys it manages, so a panel edit always wins, while a standalone user's
entry keeps working for every key the file does not mention. Alternative
rejected: `ctx.options` winning — the panel's save would then have no effect
for users with a legacy entry, the worst possible outcome of a migration.

**D2 — One shared parser in `core/`, vendored twice.** A new
`core/options-source.js` implements "read JSON, keep known keys, ignore bad
values per key with a warning to the debug log, mtime-cached". `plugin/` and
`openchamber-modelselect/service/` each consume their vendored copy, so the two
cannot drift (same pattern as `core/routing.js`).

**D3 — mtime cache, not a watcher.** The plugin reads the file at most once per
turn and re-parses only on `mtimeMs`/`size` change — the pattern already used by
`modeCache` in `plugin/src/shared/status.js`. A `fs.watch` would add a handle per
OpenCode process and a platform-specific failure mode for no gain.

**D4 — Secrets stay in the same file, mode `0600`.** Cosmetically it is the file
the user already understands; the panel treats the key as write-only (blank
field, empty keeps value). Alternative rejected: a separate keychain-backed
store — a new dependency and a new approval, for two tokens.

**D5 — Delete, don't shim.** `RELOAD_PATH`, `reloadPorts()`, `postJson()`,
`reloadOpenCode()`, the `config-reload` control and the panel's restart notice
go away in the same release. Keeping a feature-detected fallback would preserve
exactly the friction this change exists to remove.

**D6 — Migration is a copy, not a move.** On first save the panel merges the
entry's known keys into the file; the entry stays. Removing it is the
duplicate-entry notice from `ship-plugin-inside-extension`, i.e. one decision
made once, by the user.

## Risks / Trade-offs

- **Two sources can disagree** → D1 is deterministic and the panel shows which
  keys came from the entry; the README states it.
- **A hand-edited invalid file** → per-key validation with the previous value
  kept; the section shows a `note` row naming the file.
- **The token is now in a second file** (OpenCode's `auth.json` remains the
  source for API keys) → the plugin's own `token`/`jevToken` are unrelated to
  OpenCode's auth; file mode `0600` and no echo in the panel.
- **Users who configure only `opencode.json`** → unchanged behavior; nothing
  reads the file unless it exists.

## Migration Plan

1. Ship `core/options-source.js` + plugin read; verify the plugin ignores a
   missing file (no behavior change on upgrade).
2. Ship the panel writing the file and the service deletion of the reload path;
   verify a save applies on the next turn with OpenCode stopped.
3. Rollback: keep writing the entry as before by reverting the panel change;
   the file is additive and harmless if the plugin does not read it.

## Open Questions

- Whether the panel should show the effective value per key with its source
  (file / entry / default). Nice for debugging; deferrable, the design does not
  depend on it.
