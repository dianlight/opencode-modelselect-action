# Proposal

## Why

Stable v2.8.0 adds Activity "Show notes": the activity area keeps what the agent wrote between steps in view instead of collapsing after each step. Previously, activity text was folded after each step, making agent output harder to follow across replies.

## What Changes

- Render activity as persistent text between steps when Show notes is selected.
- Keep output quotable and restorable across reloads.
- Add panel toggle to switch between folded and show-notes modes.
- Update the session-action view to honor the mode.

## Minimum OpenChamber SDK version

- Stable: OpenChamber `>=2.8.0`.
- Canary: not applicable (stable-only feature).

## Capabilities

### New Capabilities

- `activity-show-notes`: activity keeps agent text between steps in view.

### Modified Capabilities

- `session-control-answers-flags`: activity state persists pending requests across steps.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, panel.
- No manifest change.