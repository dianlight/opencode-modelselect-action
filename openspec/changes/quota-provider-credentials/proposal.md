# Proposal

## Why

The 2.7.1 quota-provider contract hands the service `input.credentials`, the
credential OpenCode stores for each provider listed in `contributes.quota`. The
service ignores it (`No credentials are consumed (providers: [])`), keeps reading
`usage-limits.json`, and persists `token`/`jevToken` in the managed config. That
is why `modeselect-provider-apikey` and the reload workaround exist, and why the
managed config carries secrets at all. Using the host credential removes a
workaround and one secret store.

## What Changes

- Parse the quota request with `readQuotaProviderRequest` and map
  `input.credentials` to the Zen/Go probes.
- Prefer host credentials; fall back to the existing managed-config token only
  when the host provides none, and say so in the row.
- Stop writing `token`/`jevToken` for providers the host already holds; keep the
  write-only path for the rest.
- Add tests for credential present, absent and wrong-provider cases, and document
  the precedence.

## Out of Scope

- JEV endpoint changes and quota math.
- Removing the `token` option until every provider is host-covered.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `quota-credentials`: where the quota provider reads credentials and what it
  does when they are absent.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, tests,
  README.
- Reduces the scope of `modeselect-provider-apikey` and
  `secret-in-memory-execution`.
