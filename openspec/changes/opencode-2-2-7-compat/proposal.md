# Proposal

## Why

The host bumped OpenCode to 2.2.7. The plugin and the extension depend on OpenCode's
auth store shape, tool names, and event names; a version bump can change these
silently and break tier resolution or host detection without a test failure.

## What Changes

- Run the plugin test suite (`node --test plugin/test/`) against OpenCode 2.2.7.
- Verify `auth.json` shape, `todowrite` flag resolution, and event names still match.
- Update `engines` / docs if a compatibility floor changes.
- Add a CI or maintenance check that fails on a mismatch.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none — verification only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `plugin/test/*`, `openchamber-modelselect/test/*`, possibly `engines` floors.
- No runtime behavior change unless a mismatch is found.
- Depends on `sdk-bump-to-canary-20261112`.
