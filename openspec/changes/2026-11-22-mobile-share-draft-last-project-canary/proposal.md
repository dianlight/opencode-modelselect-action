# Proposal

## Why

The canary adds mobile share handling: a share's draft opens in the last-used project instead of a generic new session. Previously, shares always opened in a blank session with no project context, making it hard to act on the shared content.

## What Changes

- When a mobile share (text/link/file) arrives, create a draft session in the last-used project.
- If no project has been used, fall back to a new session with a prompt.
- The draft is visible immediately, ready to edit/send.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `mobile-share-draft-last-project`: shares open in the last-used project as drafts.

### Modified Capabilities

- `mobile-panel-for-modelselect`: mobile share handling.

## Impact

- `openchamber-modelselect/service/src/main.js`, `panel/src/api.js`.
- Depends on `mobile-panel-for-modelselect`.