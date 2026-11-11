# Proposal

## Why

OpenChamber 2.7.1 lists extension session actions and slash commands in the command
palette (⌘P / Ctrl+P). The `model-pick` session action is already declared, so it
becomes discoverable for free. But the extension has no slash command, so a user who
wants the dashboard or the current pick has to open the panel. A `/modelselect`
command would make the pick reachable from the keyboard, and the action label should
be palette-friendly.

## What Changes

- Add a `/modelselect` slash command via `host.onResolve` that opens the page or
  inserts the current pick as a composer chip.
- Ensure the `model-pick` action label and description are palette-friendly.
- Handle the command in the panel/background and keep it a no-op on older hosts.
- Document the command in `openchamber-modelselect/README.md`.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

(none — manifest + panel/background change, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (commands), panel, background, tests.
- Rebuilt `panel/main.js` and `background/main.js`.
- Depends on `sdk-bump-to-canary-20261110`.
