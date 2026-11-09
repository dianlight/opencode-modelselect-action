# Proposal

## Why

The plugin currently injects routing context (jev criteria, task type, tier) into
prompts through its own hooks. OpenChamber 2.7.0 lets a service set text the agent
reads in every session under a directory through `instructions.set`. Using it moves
that context out of the plugin and into the host, and removes a prompt-injection
code path and its size limits.

## What Changes

- Call `serviceHost.setInstructions(directory, text)` from the service after a
  routing sync, with the blended criteria text for the project.
- Clear (empty string) the instructions when routing sync is off or the project
  closes.
- Keep the plugin's own injection as the fallback on hosts older than 2.7.0.
- Document the precedence (host instructions vs plugin context) in the README.

## Capabilities

### New Capabilities

- `agent-instructions`: what text is pushed, when, and the fallback on older hosts.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- Rebuilt `service/main.js`; needs `engines.openchamber >= 2.7.0`.
- Depends on `adopt-opencode-role` (directory scoping) and `sdk-bump-to-2-7-1`.
