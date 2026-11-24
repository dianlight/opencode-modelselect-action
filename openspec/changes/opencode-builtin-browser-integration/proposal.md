# Proposal

## Why

OpenCode 2.4.0 ships a built-in desktop browser. Users can import sign-ins and
browsing history from Chrome, Edge, Firefox and Safari, add browser extensions,
and browse pages. Chat links that point to signed-in web services now open
signed in because the browser shares sign-in state with chat links.

## What Changes

- Detect if OpenCode 2.4.0 is running (check for the built-in browser service).
- Recommend the built-in browser as the preferred browsing mode.
- Document the built-in browser as the alternative to Electron when setting up
  remote projects.

## Out of Scope

- Migrating users from Electron to the built-in browser automatically.
- Writing its own browser extensions.
- Changes to the browser panel itself.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `opencode-builtin-browser-integration`: adopts the built-in desktop browser as the recommended browsing mode.

## Impact

- Documentation in README, extension README.

## Safe to Revert

Disable the recommendation in the documentation.
