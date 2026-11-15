# Proposal

## Why

The extension pins `@openchamber/sdk` 2.7.1 while the canary is now 2.7.3-canary.20261115.21 and stable 2.7.2. The 2.7.2/2.7.3 surface (microphone capability, per-surface settings, running project actions) is not available to the extension until the pin moves, so later adoption proposals cannot be validated.

## What Changes

- Bump `openchamber-modelselect/package.json` dependency to `@openchamber/sdk` 2.7.3-canary.20261115.21 (or 2.7.2 stable once verified).
- Raise `engines.openchamber` to `>=2.7.2` (canary `>=2.7.3`).
- Rebuild bundles and run `bun run check` / `bun run test`.
- Update `openchamber-modelselect/README.md` supported-host line.

## Out of Scope

- Adopting any new capability (handled by sibling proposals).
- Moving to a non-released version without the audit gate.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

(none — dependency bump, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, README, rebuilt bundles.