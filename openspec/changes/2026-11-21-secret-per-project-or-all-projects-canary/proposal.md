# Proposal

## Why
The canary adds capability to control secret scope (project vs all projects), removing the workaround of persisting secrets in managed config.

## What Changes
- SDK exposes secret scope control (project vs all projects)
- Updates SDK floor requirements in existing specs to use canary version
- Enables better secret management for extension integrations

## Minimum OpenChamber SDK version
- Canary: `@openchamber/sdk` `2.7.4-canary.20261121.27`
- Stable: OpenChamber `>=2.7.3` (not yet in stable; canary-only)

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