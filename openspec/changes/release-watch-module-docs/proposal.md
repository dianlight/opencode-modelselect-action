# Proposal

## Why

The SDK moved decision records and product stances into per-module docs
(`packages/sdk/src/**/DOCUMENTATION.md`, `packages/sdk/src/ui/DOCUMENTATION.md`).
`release-watch-sdk-doc-diff` diffs only the three top-level files, so it now
misses most of the contract drift it exists to catch: the module files carry the
surface changes.

## What Changes

- Diff every `DOCUMENTATION.md` under `packages/sdk/src/` (including `src/ui/`),
  not only the top-level files.
- Report added and removed headings per module file in the daily job output.
- Keep the last-three-versions snapshot, keyed per module path.

## Out of Scope

- The SDK bump half of `release-watch-sdk-doc-diff` (already superseded).
- Host changelog parsing.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.2` (module docs exist at 2.7.2; the layout is not
  canary-only).

## Capabilities

### New Capabilities

- `release-watch-module-docs`: which SDK doc files the daily job diffs and how it
  reports them.

### Modified Capabilities

(none)

## Impact

- `scripts/release-watch.js`, its state file shape, `scripts/README.md`.
- Supersedes `release-watch-sdk-doc-diff`.
- No extension or plugin behavior change.
