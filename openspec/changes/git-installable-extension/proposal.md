# Proposal

## Why

The OpenChamber extension in `openchamber-modelselect/` ships today as a folder
(or ZIP) install, and OpenChamber only auto-updates extensions installed from a
git URL. Every version bump therefore means the user deletes and re-adds the
extension by hand, and a stale folder install can sit for months with a
`service/main.js` that no longer matches the plugin's cache format.

## What Changes

- Add a git-installable distribution of the extension: a repository whose root is
  the extension package (its own repo, or a dedicated export branch of this
  monorepo), carrying only the built files the host needs.
- Have the existing maintenance/release automation publish that repository on
  every release that changes the extension, bumping `version` in `package.json`
  first so OpenChamber's update check sees a newer version.
- Document the one-click path in `openchamber-modelselect/README.md`:
  `openchamber://extensions/install?url=…` and the Settings → Extensions field,
  plus what a folder install still does (no update check, replace by hand).
- Keep the folder install as the development path: it runs from the working
  tree, the git install is generated.

## Capabilities

### New Capabilities

- `extension-distribution`: how the OpenChamber extension is packaged and
  delivered — which files a distributed build contains, how a new version
  becomes visible to OpenChamber's update check, and how a user installs and
  updates it without touching a terminal.

### Modified Capabilities

(none)

## Impact

- New: a Git repository (or export branch) owned by the project, plus a release
  step in `.github/workflows/opencode-maintenance.yaml` (or a dedicated
  workflow) that pushes the built extension.
- `openchamber-modelselect/package.json` (version bumps per release),
  `openchamber-modelselect/README.md` (install/update instructions).
- No runtime behavior change for the extension itself; no new permissions.
- Depends on OpenChamber `>=2.6.1` shipping the update check (release after the
  extension-authoring PR 6379); folder installs keep working unchanged.
