# Proposal

## Why

OpenChamber 2.7.1 adds `tool` (the call running now or last finished) and
`context` (tokens used vs model limit) to session records. The extension's
session action and status section only show the routed pick, so a dashboard of
sessions shows nothing about what the agent is doing or how full its context is.

## What Changes

- Read `tool` and `context` from session records in the service.
- Surface the current tool name/target and context fill percent in the session
  action toast and in a status row when available.
- Clear tool display on idle/error and after compaction (context becomes null).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `session-live-work-surface`: when and how tool and context are shown.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, tests, rebuilt bundle.
- Depends on `sdk-bump-to-canary-20261113`.
