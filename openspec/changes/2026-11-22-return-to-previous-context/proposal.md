# Proposal

## Why

The canary adds UI to return to the previous context panel when closing a session. Previously, closing a panel left the tab open and showed only the last opened panel. This restores the expected behavior where closing returns to the prior context.

## What Changes

- Close a panel/context and have it return to the previous panel instead of staying on the closed one.
- Preserve the current row's focus and scroll position before returning.
- Fall back to leaving the closed panel if no previous exists.

## Minimum OpenChamber SDK version

- Stable: OpenChamber `>=2.8.0` (released 2026-11-22).

## Capabilities

### New Capabilities

- `ui-close-context`: close-and-return-to-previous-panel behavior.

### Modified Capabilities

- `context-panel`: close action now navigates back rather than persisting.

## Impact

- `openchamber-modelselect/panel/src/...`, README.
- Depends on `shared-opencode-service-mode`.
