# Proposal

## Why

The 2.7.3 SDK adds the invariant: quota provider IDs are validated by shape at
install because credentials can arrive later; `configured: false` sends the user
to OpenChamber's Providers page and applies only to missing listed OpenCode
credentials, while a missing extension-owned key is a configured provider with an
error naming where to enter it. `quota-provider-credentials` and
`modeselect-provider-apikey` predate this and never say how a missing key must
read. Adopting the invariant's wording keeps the quota row truthful on 2.7.3
hosts.

## What Changes

- Report the provider as configured when the host lists it, even if its
  extension-owned key is absent, and put the "where to enter it" text in the
  row's error.
- Keep `configured: false` only for missing listed OpenCode credentials, pointing
  at OpenChamber's Providers page.
- Add a test for each state: host credential present, extension key missing,
  provider absent.

## Out of Scope

- Quota math and the JEV endpoint.
- Removing the write-only token path.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.3` (released 2026-11-19).

## Capabilities

### New Capabilities

- `quota-provider-configured-state`: how a quota provider reports configured vs
  misconfigured under the host's validation.

### Modified Capabilities

- `quota-credentials`: row wording for the three states.

## Impact

- `openchamber-modelselect/service/src/main.js` (quota provider row), tests,
  README.
- Depends on `quota-provider-credentials`.
