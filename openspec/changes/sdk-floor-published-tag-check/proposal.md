# Proposal

## Why

Seven active changes declare `stable: ">=2.7.3"` although no 2.7.3 stable tag
exists: GitHub tags stop at v2.7.2 and npm `latest` is 2.7.2. Floors that name an
unreleased version make `engines.openchamber` unsatisfiable and hide real drift
from the audit.

## What Changes

- Extend the docs-parsing check from `sdk-surface-audit-2-7-2`: fail when a
  declared stable floor names no published tag (compare against the GitHub tags
  list and npm dist-tags).
- Retarget the seven floors to the lowest published version that truly carries
  each surface.
- Document the rule in `openchamber-modelselect/README.md`.

## Out of Scope

- Changing any behavior; canary floors stay as declared.
- Bumping the SDK pin.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — tooling and metadata, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `.openspec.yaml` floors across changes, the docs-check script, README.
- Depends on `sdk-surface-audit-2-7-2`.
