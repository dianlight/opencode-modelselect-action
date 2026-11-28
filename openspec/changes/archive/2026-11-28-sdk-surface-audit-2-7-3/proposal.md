# Proposal

## Why

The canary SDK `2.7.4-canary.20261120.26` differs from stable `2.7.3` only in
its version string, so the extension's pinned `@openchamber/sdk` `2.7.2` and
`engines.openchamber >=2.7.1` floors have never been audited against the
`2.7.3` documentation. Two earlier planning changes covered the `2.7.2` surface
and published-tag floors and are now archived; their checks must be folded into
one repeatable audit.

## What Changes

- Re-audit the extension's SDK floor against the `2.7.3` `DOCUMENTATION.md`,
  `GUEST_SERVICES.md` and bundled dist surface, including the host-rendered
  status section, guest instruction skip-unchanged guards, XDG state home and
  service event invariants.
- Record which of the already-planned `2.7.3` behaviors are genuinely available
  at the declared floor and raise the floor where they are not.
- Make the maintenance check fail when a declared stable SDK floor does not name
  a published release tag, replacing the archived tag-check change.

## Out of Scope

- Bumping the SDK dependency itself (covered by the release-watch changes).
- OpenCode runtime compatibility (`opencode-2-3-2-compat`).
- Status section UI work.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.3` (released 2026-11-19).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `scripts/opencode_maintenance.py`,
  generated audit docs, release-watch tests.
- Supersedes the archived `sdk-surface-audit-2-7-2` and
  `sdk-floor-published-tag-check`.
