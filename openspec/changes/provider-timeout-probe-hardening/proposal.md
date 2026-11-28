# Proposal

## Why

OpenCode 2.4.0 applies provider timeouts to all requests. The plugin still keeps custom retry TTLs and response-fingerprint sniffing in `plugin/src/shared/usage.js` to detect slow or broken providers.

## What Changes

- Rely on host provider timeouts for probe failures.
- Remove local retry TTL heuristics that conflict with the host timeout.
- Keep fingerprint-based quota parsing where the host provides no structured data.

## Out of Scope

- Changing provider timeout configuration.
- Changing failover ordering.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1`.

## Capabilities

### New Capabilities

- `provider-timeout-handling`: defines provider timeout handling for quota and catalog probes.

### Modified Capabilities

(none)

## Impact

- `plugin/src/shared/usage.js`
- `plugin/src/shared/freequota.js`
- `plugin/src/v2.js`
