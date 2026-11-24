# Proposal

## Why
The host adds SDK capability to expose session context and token usage to extensions, enabling better integration with the host OpenChamber.

## What Changes
- SDK exposes session context and token usage to extensions via new API surface
- Updates SDK floor requirements in existing specs to the released stable version
- Enables extensions to better integrate with session state

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `sdk`: expose session context and token usage to extensions

### Modified Capabilities
- `service-data-dir`: now includes session context and token usage information
- `host-detection`: enhanced to work with session context

## Impact
- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, tests
- `openchamber-modelselect/panel/src/api.js`, `background/main.js`
- `opencode-console` integration with session data

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths