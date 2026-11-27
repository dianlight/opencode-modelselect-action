# Proposal

## Why

OpenCode 2.4.0 adds `experimental.open` and `experimental.close` to the Browser
contract, allowing extensions to open and close browser context programmatically.
The modelselect extension's browser integration (`opencode-builtin-browser-integration`)
only documents the built-in browser; it does not yet open/close browser context
for pick-related links.

## What Changes

- Use `Browser.experimental.open(url)` to open modelselect pick links in the
  built-in browser.
- Use `Browser.experimental.close()` to clean up browser context after a pick is
  resolved.
- Gate on host support; no-op on older hosts.
- Add tests for open/close lifecycle.

## Out of Scope

- Migrating users from Electron to the built-in browser.
- Writing browser extensions.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `browser-contract-open-close`: modelselect uses browser open/close contract.

### Modified Capabilities

- `opencode-builtin-browser-integration`: adds open/close lifecycle.

## Impact

- `openchamber-modelselect/service/src/main.js`, tests.
- Panel/background browser handling.
