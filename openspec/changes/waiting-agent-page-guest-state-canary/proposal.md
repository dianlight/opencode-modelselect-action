# Proposal

## Why

OpenChamber 2.8.2-canary.20261127.33 (PR 7661) reports a session waiting on an agent page as waiting on the user. The extension currently injects form and permission messages and sniffs field keys with regexes to guess that state.

## What Changes

- Consume the host waiting-on-you state for agent pages.
- Remove injected `PERMISSION_MESSAGE`/`PAGE_MESSAGE` text and key sniffing where the host state covers it.
- Keep the model-pick fields and their separate 'last known' note unchanged.

## Out of Scope

- Changing the agent page UI.
- Auto-answering permissions unrelated to model selection.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261127.33`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `agent-page-waiting-state`: defines how a guest extension sees a session waiting on an agent page as waiting on the user.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/answers.js`
- `openchamber-modelselect/service/src/main.js`
- `openchamber-modelselect/service/src/view.js`
