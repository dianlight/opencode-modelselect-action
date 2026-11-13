# Proposal

## Why

`sdk-bump-and-release-watch` proposed diffing the SDK's top-level docs
(`GUEST_SERVICES.md`, `API.md`, `DOCUMENTATION.md`) on version moves so new
contributions or service roles are reported by name instead of being discovered by
hand. The SDK bump part of that proposal is superseded by `sdk-bump-to-canary-20261113`,
but the doc-diff tooling is still valuable and not implemented. Extract it into its
own change.

## What Changes

- Extend `scripts/release-watch.js`: when the SDK's canary or latest tag moves,
  fetch that version's tarball and diff the top-level sections of
  `GUEST_SERVICES.md`, `API.md` and `DOCUMENTATION.md` against the last stored
  snapshot, reporting headings added and removed.
- Store the snapshot per SDK version in
  `.opencode/.modelselect-cache/release-watch.json` (`sdkDocs`), keeping the last
  three versions.
- Report a new contribution or service role by name in the daily job output.
- Document the doc-diff in `scripts/README.md` (or the script header).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none — tooling only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `scripts/release-watch.js`, its state file shape, maintenance workflow invocation.
- `scripts/README.md` (or script header).
- No extension or plugin behavior change.
- Supersedes the tooling half of `sdk-bump-and-release-watch`.
