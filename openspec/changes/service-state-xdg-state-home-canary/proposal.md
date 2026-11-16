# Proposal

## Why

OpenChamber 2.7.3 passes `XDG_STATE_HOME` to extension services, so a service
has a well-known per-user state location in addition to
`OPENCHAMBER_SERVICE_DATA_DIR`. The modelselect service
(`adopt-service-data-dir`) currently relies only on the data dir and falls back
to in-memory state on older hosts; using `XDG_STATE_HOME` as a fallback keeps
service-owned state durable on hosts that provide it but not the data dir.

## What Changes

- Read `XDG_STATE_HOME` in `service/src/main.js` and use
  `$XDG_STATE_HOME/openchamber/modelselect/` as the fallback state folder when
  `OPENCHAMBER_SERVICE_DATA_DIR` is absent.
- Keep the data dir authoritative when both are present.
- Document the precedence and add a test.

## Out of Scope

- Changing which state is persisted.
- Reading the plugin's cache.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.3`.

## Capabilities

### New Capabilities

(none — extends `service-data-dir`.)

### Modified Capabilities

- `service-data-dir`: fallback state location.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, tests.
- Rebuilt `service/main.js`.
