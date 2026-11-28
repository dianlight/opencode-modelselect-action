# Proposal

## Why

OpenChamber 2.8.2-canary.20261127.33 (PR 7604) reads `context_length` and `max_completion_tokens` from gateway model lists. The plugin falls back to hard-coded 2,000,000 and 128,000 virtual limits whenever a catalog entry is missing.

## What Changes

- Read context and completion limits from the gateway model list before falling back.
- Remove the hard-coded virtual-limit constants from `plugin/src/v2.js`.
- Keep a documented fallback only when the gateway omits both fields.

## Out of Scope

- Changing model selection scores or task types.
- Changing gateway authentication.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261127.33`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `gateway-model-context-limits`: defines how context and completion limits come from gateway model lists.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`
- `plugin/src/shared/runtime-catalog.js`
- `plugin/src/shared/core/routing.js`
- `config/model-capabilities.yaml`
