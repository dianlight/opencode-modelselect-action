# Proposal

## Why

OpenCode 2.4.0 advertises supported freeform tool-input formats in the SDK model
capability schemas. The modelselect registry and tier resolution do not consume
this field, so models that support freeform input (e.g. `execute`, `patch`) are
not preferred when a task needs freeform tool calls.

## What Changes

- Extend the model registry to include a `freeformToolInput` capability flag
  per model, populated from the SDK capability schema.
- Prefer models with freeform support when a task type declares it.
- Update `config/model-capabilities.yaml` and maintenance script to fetch the
  capability.
- Add tests for capability-driven selection.

## Out of Scope

- Changing the model scoring logic.
- Adding new model providers.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `model-capability-freeform-tool-input`: modelselect uses freeform tool-input capability.

### Modified Capabilities

- `provider-model-selection`: model entries gain freeform capability.

## Impact

- `config/model-capabilities.yaml`, `scripts/opencode_maintenance.py`,
  `data/model-registry-v2.json`, tests.
