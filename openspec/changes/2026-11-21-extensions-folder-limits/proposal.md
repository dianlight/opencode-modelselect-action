# Proposal

## Why
The host adds capability to limit extensions to chosen folders, enabling better extension scoping and security.

## What Changes
- SDK exposes extension folder limits capability
- Updates SDK floor requirements in existing specs to the released stable version
- Enables extension to be limited to specific project folders

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `extensions`: limit extensions to chosen folders

### Modified Capabilities
- `openchamber-modelselect` manifest: added folder restriction support
- `service-state-xdg-state-home`: enhanced to work with folder-scoped extensions

## Impact
- `openchamber-modelselect/package.json` manifest updates
- `opencode-console` integration with extension scoping

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths