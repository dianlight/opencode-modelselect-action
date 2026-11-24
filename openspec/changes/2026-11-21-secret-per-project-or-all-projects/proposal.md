# Proposal

## Why
The host adds capability to control secret scope (project vs all projects), removing the workaround of persisting secrets in managed config.

## What Changes
- SDK exposes secret scope control (project vs all projects)
- Updates SDK floor requirements in existing specs to the released stable version
- Enables better secret management for extension integrations

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `secret`: keep secret.run secret for project or all projects

### Modified Capabilities
- `secret-in-memory-execution`: now supports scoped secret execution (project vs all)
- `plugin/src/shared/jev.js`: updated for secret scope awareness

## Impact
- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`
- `opencode-console` integration with secret management
- `secret-in-memory-execution` implementation

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths