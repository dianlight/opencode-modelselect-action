# Proposal

## Why
The host adds "leads" - sessions that run a direction of work with summit and pennant marking, able to ask with answers, suggest work and take over sessions. This extends the worker session model for better session hierarchy.

## What Changes
- SDK exposes leads session type and capabilities
- Updates SDK floor requirements in existing specs to the released stable version
- Enables hierarchical session management and better session hierarchy

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `sessions`: leads - sessions that run a direction of work

### Modified Capabilities
- `worker-session-exclusion`: now includes leads in session hierarchy handling
- `session-control-answers-flags`: enhanced to support lead session interactions

## Impact
- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`
- `opencode-console` integration with lead sessions
- Host evidence mapping extended for lead sessions

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths