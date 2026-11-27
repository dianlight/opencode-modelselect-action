# Proposal

## Why

The canary moves the context panel into a window of its own and keeps the panel window within reach from the chat window. The modelselect extension's panel and Work Status surface currently assume a single shared panel context, so a panel that lives in its own window needs its own reachability and focus handling.

## What Changes

- Treat the context panel as its own window: restore focus and scroll position when it reopens beside the chat.
- Keep the panel window reachable from the chat window (no orphaned windows).
- Align the extension panel entry points with the new window lifecycle.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `context-panel-own-window`: context panel runs in its own window with chat reachability.

### Modified Capabilities

- `mobile-panel-for-modelselect`: panel entry follows the new window lifecycle.

## Impact

- `openchamber-modelselect/panel/src/main.js`, README.
- Depends on `shared-opencode-service-mode-canary`.

## Out of Scope

- Changes to the host window manager itself.
- Non-extension code paths.