# Proposal

## Why

OpenChamber 2.7.1 lets an extension ship provider logos via
`contributes.providerLogos`. The Models tab currently relies on generic marks,
so provider identity is weak.

## What Changes

- Add `contributes.providerLogos` mapping common provider IDs used in
  `model-config-cache.json` to bundled SVG/PNG files.
- Verify logos render in the Models tab and status section without capability
  changes.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none - manifest-only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, bundled logo assets.
- Depends on `sdk-bump-to-canary-20261110`.
