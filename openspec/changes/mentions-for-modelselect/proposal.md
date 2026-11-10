# Proposal

## Why

OpenChamber supports `contributes.mentions` so an extension can add rows to the
composer `@` menu. Modelselect could expose task types and current picks there
for quick insertion into a prompt.

## What Changes

- Declare `contributes.mentions` with search/resolve paths.
- Implement mention search returning task types and the current pick.
- Resolve a mention into a short context snippet.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `modelselect-mentions`: which rows appear and what they resolve to.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, service main, panel, tests.
- Depends on `sdk-bump-to-canary-20261110`.
