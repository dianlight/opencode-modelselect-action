# Proposal

## Why
The host adds capability for default model, thinking level, and agent for chats, directly supporting the modelselect extension's core functionality of routing models.

## What Changes
- SDK exposes default model, thinking level, and agent for chats
- Updates SDK floor requirements in existing specs to the released stable version
- Enables model selection extension to set session-level defaults

## Minimum OpenChamber version
- Stable: OpenChamber `>=2.8.0`

## Capabilities
### New Capabilities
- `sessions`: default model, thinking level and agent for chats

### Modified Capabilities
- `adopt-session-record-fields`: now includes default model/thinking/agent fields
- `modeselect-provider-apikey`: enhanced to work with session-level defaults

## Impact
- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`
- `opencode-console` integration with chat model configuration
- Model selection workflow becomes session-first rather than per-send

## Out of Scope
- Any changes to core API contracts that are not part of the SDK exposure
- Changes that would affect non-extension code paths