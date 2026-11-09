# Proposal

## Why

The extension is pinned to `@openchamber/sdk` `2.6.2-canary.20261106.9`, while
the host canary already publishes `.11`. The gap matters twice: the pinned types
do not know the `opencode` service role, `contributes.opencodePlugin` or
`OPENCHAMBER_SERVICE_DATA_DIR`, so the proposals that use them cannot compile or
be checked against the real manifest schema; and nothing in this repository
would have noticed, because `scripts/release-watch.js` compares version numbers
and leaks a keyword filter, not the SDK's documented surface. The last host
release added an entire role and a new contribution without a single line in
its release notes.

## What Changes

- Bump `openchamber-modelselect` to `@openchamber/sdk`
  `2.6.2-canary.20261107.11`, reinstall, rebuild both bundles, and run the four
  test files.
- Extend `scripts/release-watch.js`: when the SDK's canary or latest tag moves,
  fetch that version's tarball and diff the top-level sections of
  `GUEST_SERVICES.md`, `API.md` and `DOCUMENTATION.md` against the last stored
  snapshot, reporting headings added and removed.
- Store the snapshot per SDK version in `.opencode/.modelselect-cache/release-watch.json`
  (`sdkDocs`), keeping the last three versions.
- Report a new contribution or service role by name in the daily job output, so
  a proposal like `adopt-opencode-role` starts from a signal instead of a manual
  read of the repository.
- Document the SDK pin, the reason for a canary pin, and how the doc diff is
  produced in `openchamber-modelselect/README.md` and `scripts/README.md` (or
  the script header).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.6.2-canary.20261107.11`.
- Stable: OpenChamber `>=2.6.2`.

## Capabilities

### New Capabilities

(none — this change only moves a dependency and the maintenance tooling that
watches it; no extension or plugin behavior changes, hence `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `bun.lock`, rebuilt `service/main.js`,
  `panel/main.js` and `background/main.js`.
- `scripts/release-watch.js`, its state file shape, and the maintenance workflow
  invocation (no workflow change expected).
- `openchamber-modelselect/README.md`, `CHANGELOG.md`.
- No manifest, permission, or spec-level behavior change.
- Prerequisite for `adopt-opencode-role` and `ship-plugin-inside-extension`.
