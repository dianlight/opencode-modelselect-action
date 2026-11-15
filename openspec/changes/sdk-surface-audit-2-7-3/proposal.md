# Proposal

## Why

The 2.7.1 audit is stale: the pin now targets 2.7.3 canary, whose `API.md`/`DOCUMENTATION.md` document per-surface settings, running project actions and unchanged guest-instruction writes. Proposals keep declaring floors and contributions that no longer match the contract.

## What Changes

- Re-audit every dependent proposal against the 2.7.3 SDK docs.
- Correct `x-minOpenchamberSdk` and `engines.openchamber` floors to the lowest version where each surface genuinely exists.
- Add a docs-parsing check that fails when a declared contribution or service key is absent from the pinned SDK docs.
- Document the mapping in `openchamber-modelselect/README.md`.

## Out of Scope

- Adding new contributions (handled by sibling proposals).
- Moving the pin away from a released version.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — tooling and audit, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `.openspec.yaml` floors across changes, a docs-check script, README.
- Supersedes `sdk-surface-audit-2-7-1`.