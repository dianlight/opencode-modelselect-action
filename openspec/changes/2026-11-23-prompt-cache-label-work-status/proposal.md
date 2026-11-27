# Proposal

## Why

The canary clarifies the prompt cache label in work status. The modelselect status section shows cache/usage rows whose labels are ambiguous, and the new host label lets the section reuse the host's wording instead of a custom one.

## What Changes

- Adopt the host's prompt cache label in the Work Status section.
- Remove the custom cache label string.
- Keep the row's tone and tooltip consistent with the host.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `prompt-cache-label-work-status`: section uses host prompt cache label.

### Modified Capabilities

- `status-section-polish`: cache row label aligned with host.

## Impact

- `openchamber-modelselect/service/src/view.js`.
- Tests under `openchamber-modelselect/test/`.

## Out of Scope

- Changing cache percentage calculation.