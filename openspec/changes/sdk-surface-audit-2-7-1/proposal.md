# Proposal

## Why

The last analysis treated `contributes.marks`, `waits`, `tools` cards, `blocks`,
`panel.mobile`, `ready.device`, `providerLogos`, `service.schedule` and
`instructions` as 2.7.2-canary-only and added `sdk-bump-to-canary-20261113` as a
prerequisite. The package now pins `@openchamber/sdk` 2.7.1 stable, whose
`API.md` and `GUEST_SERVICES.md` document all of them, so the bump is obsolete
and several proposals declare a `>=2.7.2` floor they do not need. Without an
audit, proposals keep drifting from the real contract.

## What Changes

- Check every dependent proposal's contribution against the pinned 2.7.1 docs.
- Correct `x-minOpenchamberSdk` and `engines.openchamber` floors to `>=2.7.1`
  where the surface exists there; keep `>=2.7.2` only for surface that genuinely
  lands later.
- Add a test or script that parses the pinned SDK `API.md` and
  `GUEST_SERVICES.md` and fails when a declared contribution or service key is
  absent.
- Bump to 2.7.2 stable only when published, with this audit as the gate.
- Document the mapping in `openchamber-modelselect/README.md`.

## Out of Scope

- Adding new contributions.
- Moving the pin away from a released version.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none — tooling and audit, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `.openspec.yaml` floors across changes,
  a small docs-check script, README.
- Supersedes `sdk-bump-to-canary-20261113`.
