# Proposal

## Why

The canary introduces `opencode serve --service` shared mode, so the OpenCode service runs as a persistent background process that CLI, TUI, and desktop app share. Previously, every extension startup triggered a new OpenCode CLI instance. The shared mode eliminates redundant launches, enables global plugin switches, and reduces resource usage — especially noticeable with `opencode update` and `opencode update` notifications.

## What Changes

- Wire the extension into the OpenCode shared service lifecycle (start/stop on extension enable/disable).
- Expose session context and token usage through the shared service (replacing in-memory state).
- Global plugin switches become a single setting, no longer duplicated per-extension.
- Fall back to the old per-extension mode on hosts without the shared service.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `shared-opencode-service-mode`: OpenCode service runs persistently and is shared across sessions and surfaces.

### Modified Capabilities

- `session-context-token-usage`: session context data now comes from the shared service rather than per-extension state.
- `plugin-presence`: plugin state is now owned by the shared service, not the extension.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, `README.md`.
- Requires `@openchamber/sdk` `2.8.1-canary.20261122.28` or newer.
- Depends on `external-local-opencode-plugin-bridge-canary`.