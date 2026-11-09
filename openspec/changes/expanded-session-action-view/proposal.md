# Proposal

## Why

The canary gives every OpenChamber tool action its own expanded view ("chat: give
every OpenChamber tool action its own expanded view"). The "Model select pick"
session action currently shows a one-line toast; an expanded view would show
task, tier, model, Think, Jev reason and age without leaving the chat.

## What Changes

- Add an expanded view for the `model-pick` action that renders the full pick
  summary (task, tier, model, Think, Jev, Source, Updated) in a block surface.
- Keep the toast as the fallback for hosts without block surfaces.
- Validate the block against the host schema in tests.

## Capabilities

### New Capabilities

- `session-action-expanded-view`: what the expanded view shows and its fallback.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/background/src/main.js`, `service/src/main.js` (`/pick`),
  manifest, tests.
- Rebuilt `background/main.js` and `service/main.js`.
- Depends on `sdk-bump-to-2.7.1`.
