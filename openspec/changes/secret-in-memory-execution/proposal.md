# Proposal

## Why

The canary adds "secret: run a command with secrets in memory", so a secret request
can run a command using the secret without persisting it. This project stores
`token`/`jevToken` in the managed config (write-only) and uses them to call the JEV
endpoint; persisting them is the only reason the managed config carries secrets at
all, and the reload workaround exists partly to apply secret changes.

## What Changes

- Offer an in-memory execution path for JEV/secret-dependent commands instead of
  reading persisted tokens, where the host supports it.
- Keep the persisted write-only fields as the fallback for older hosts and for
  unattended runs.
- Document the two paths and the precedence in the README.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Capabilities

### New Capabilities

- `secret-in-memory-execution`: when secrets run in memory vs. persisted.

### Modified Capabilities

(none)

## Impact

- `plugin/src/shared/jev.js`, `openchamber-modelselect/service/src/*`, tests.
- Depends on `options-out-of-opencode-config` and `sdk-bump-to-2-7-1`.
