# Proposal

## Why

The OpenCode changelog for the current canary line (v2.4.2) notes that SDK
Promise plugin API calls honor the call `signal`, and aborting rejects the
call. The modelselect service's delivery and abort paths (wait delivery,
composer delivery, plugin tool cooperative stop) can rely on deterministic
rejection once the signal-aware client lands on the canary.

## What Changes

- Adopt signal-honoring Promise plugin API calls for the abort paths.
- Keep abort semantics explicit in wait and delivery flows.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `plugin-api-call-signal`: Promise plugin API calls honor the call signal.

### Modified Capabilities

- None.

## Impact

- `openchamber-modelselect/service/src/` abort paths.
- `plugin/src/shared/` wait and delivery helpers.

## Out of Scope

- Effect client abort semantics (host-side).
- New plugin tool surface.
