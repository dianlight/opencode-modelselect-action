# Proposal

## Why

The canary bundles the OpenCode server in `@openchamber/web` and uses it for SSH remote startup and the Docker image. The modelselect extension's service assumes a separately installed OpenCode server and includes workarounds for locating and restarting it; a bundled server removes that dependency.

## What Changes

- Detect and use the host-bundled OpenCode server when present.
- Remove the manual server-locating and restart workarounds.
- Fall back to the installed CLI when no bundled server exists.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `bundled-opencode-server-web`: prefer the bundled OpenCode server.

### Modified Capabilities

- `opencode-plugin-update`: server lifecycle follows the bundled server.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`.
- README install instructions.

## Out of Scope

- Changes to OpenCode's own packaging.