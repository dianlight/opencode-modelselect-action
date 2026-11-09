# Proposal

## Why

The canary SDK gives services a data folder and tracker extensions learn about
their account through `ready.connection` and `host.onConnection`. The quota
provider in this project is a tracker (`provides: ["quota"]`) but it only reads a
cached file and has no notion of connection changes, so a sign-in/sign-out does
not refresh it until the next poll.

## What Changes

- Subscribe the quota provider to `ready.connection`/`host.onConnection` and refresh
  `usage-limits.json` handling on connection changes.
- Fall back to the current file-based read on hosts without the messages.
- Document the behavior in the README.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `quota-tracker-connection`: how the quota provider reacts to connection changes.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js` (quota provider), tests.
- Rebuilt `service/main.js`.
- Could fold into `adopt-service-data-dir`; depends on `sdk-bump-to-2-7-1`.
