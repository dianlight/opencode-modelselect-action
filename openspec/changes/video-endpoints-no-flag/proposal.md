# Proposal

## Why

OpenCode 2.4.0 makes the video endpoints (`experimental.generate.video.create`
and `.get`) no longer require the `experimental.video_generate` flag. The
modelselect extension gates video-related functionality (if any) behind the flag,
which is now unnecessary and blocks usage on hosts that have the endpoints but
not the flag enabled.

## What Changes

- Remove the `experimental.video_generate` flag gate from video endpoint calls.
- Call `experimental.generate.video.create` / `.get` directly.
- Update capability checks to detect endpoints rather than the flag.
- Add tests for flag-less video endpoint usage.

## Out of Scope

- Adding video generation features to modelselect.
- Changes to the host video runtime.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `video-endpoints-no-flag`: modelselect uses video endpoints without flag.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- Capability detection logic.
