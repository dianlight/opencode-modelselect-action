# Proposal

## Why

The canary lets agents see and close In work sessions ("agent-tool: let agents see
and close In work sessions"). This project's status section reports work status
but offers no agent-facing action on those sessions, so an agent that wants to
clean up or inspect In work sessions has to ask the user.

## What Changes

- Expose an agent tool listing In work sessions for the project (via the host
  OpenCode connection) and one to close a named session.
- Reuse `sessions.stop`/`sessions.status` from the SDK; no new permission beyond
  `opencode`.
- Keep the tool read-only by default; closing requires an explicit argument.

## Capabilities

### New Capabilities

- `agent-tool-in-work`: listing and closing In work sessions from an agent.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, manifest, tests.
- Rebuilt `service/main.js`.
- Depends on `adopt-opencode-role` and `sdk-bump-to-2.7.1`.
