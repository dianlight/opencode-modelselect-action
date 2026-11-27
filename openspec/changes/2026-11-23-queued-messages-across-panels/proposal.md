# Proposal

## Why

The canary keeps other panels' queued messages when one panel saves. The modelselect panel's save (plugin options or extension config) currently triggers a reload that can drop queued messages in sibling panels, losing in-flight composer drafts.

## What Changes

- Make panel saves preserve queued messages in other panels.
- Scope the reload to the modelselect panel only.
- Add a regression test for queued-message survival across a save.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `queued-messages-across-panels`: panel saves no longer drop sibling queued messages.

### Modified Capabilities

- `expanded-session-action-view`: save path keeps queued drafts.

## Impact

- `openchamber-modelselect/panel/src/main.js`, `service/src/main.js`.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Changing the queue store schema.