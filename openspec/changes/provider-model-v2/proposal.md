# Proposal

## Why

The select-model action, the OpenCode plugin and the OpenChamber extension all resolve a model from `data/model-config.json`. That file today only carries ranked Zen/Go lists plus a key-agnostic provider catalog. A provider connected in OpenCode Console is catalogued as `external`, but a model only enters a routing chain when its canonical id collides with a Zen/Go ranked model, so automatically selectable models are effectively limited to the engine providers; the free/go split is derived statically from cost instead of being chosen at runtime.

## What Changes

- Add change `provider-model-v2`: a versioned v2 provider-model data/config layer that coexists with v1 during transition.
- v2 model registry: one entry per model, with a list of free/non-free variants across providers and their costs.
- v2 task types reference a single model id (task -> model id) instead of per-provider model strings.
- Plugin, extension and action share one base selection logic.
- Runtime selection: task -> model -> provider availability, choosing free-first or go-first; engine providers are ordinary providers and win ties on equal cost+score against external ones.
- README: new section, model/provider tables moved to referenced Markdown files.

## Capabilities

### New Capabilities

- `provider-model-selection`: how a task resolves a model variant across providers at runtime, via task -> model id, per-model free/non-free variants and provider availability.

### Modified Capabilities

(none)

## Impact

- `scripts/opencode_maintenance.py` (v1+v2 writes, v2 registry build).
- `data/model-config.json`, `data/provider-catalog.json`, `config/task-types.yaml` (v2 shapes).
- `core/`, `plugin/src/shared/`, `github-action/src/` (shared base chain, v2 resolution).
- `openchamber-modelselect/service/src/` (status surfaces).
- `README.md` plus new referenced Markdown tables.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.2`.
