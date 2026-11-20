# Proposal

## Why

The 2.7.3 canary audit (`sdk-surface-audit-2-7-3-canary`) is stale: the
extension pins `@openchamber/sdk` 2.7.2 stable, and its SDK surface (marks,
waits, tools cards, blocks, panel.mobile, ready.device, providerLogos,
service.schedule, instructions, sessionControl.answers) is what the proposals
actually target. Re-auditing against the 2.7.2 docs corrects floors and
contribution keys to the contract the extension ships.

## What Changes

- Re-audit every dependent proposal against the 2.7.2 SDK docs.
- Correct `x-minOpenchamberSdk` and `engines.openchamber` floors to the lowest
  version where each surface genuinely exists.
- Add a docs-parsing check that fails when a declared contribution or service
  key is absent from the pinned SDK docs.
- Document the mapping in `openchamber-modelselect/README.md`.

## Out of Scope

- Adding new contributions (handled by sibling proposals).
- Moving the pin away from 2.7.2.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — tooling and audit, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `.openspec.yaml` floors across changes, a docs-check script, README.
- Supersedes `sdk-surface-audit-2-7-3-canary`.
