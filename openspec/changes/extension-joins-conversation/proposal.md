# Proposal

## Why

The canary lets extensions join the conversation and act on their own. This
project's service only answers reads and writes files; it never posts a message,
so routing decisions (which task/tier/model was picked and why) are invisible in
the chat unless the user opens the section.

## What Changes

- After a routed turn, post a short summary (task, tier, model, Think, Jev reason)
  to the session via `sessions.send` or `panels.emit`, gated by a new option.
- Keep it off by default to avoid noise; expose the toggle in the Extension tab.
- Handle `stopped`/busy sessions gracefully (log and skip).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `extension-conversation-participation`: when and what the extension posts.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, `panel/src/ext-tab.js`, tests.
- Rebuilt `service/main.js` and `panel/main.js`.
- Depends on `adopt-session-control-answers` and `sdk-bump-to-2-7-1`.
