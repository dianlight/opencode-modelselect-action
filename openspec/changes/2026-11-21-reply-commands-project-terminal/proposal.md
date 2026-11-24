# Proposal

## Why
The host adds capability to run reply commands in the project terminal, enabling command execution from chat replies.

## What Changes
- SDK exposes reply command execution in project terminal
- Updates SDK floor requirements in existing specs to the released stable version
- Enables agent to run shell commands directly from chat replies

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `chat`: run a command from the agent's reply

### Modified Capabilities
- `terminal`: project actions start without opening terminal
- `session-work`: read changed files and background work before asking Jev

## Impact
- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`
- `opencode-console` integration with reply command execution

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths