# Design

## Context

The v1 selection path (`data/model-config.json` task entries with `go`/`free`/`ranked` lists, resolved by `core/chain.js` against `data/provider-catalog.json`) derives free/paid state statically from blended cost and provider. External console providers enter the chain only through canonical-id collisions with Zen/Go models. Task types therefore cannot name an external model directly, and runtime preference (free-first vs go-first) is baked into tier logic instead of being chosen at runtime.

## Goals / Non-Goals

**Goals:**

- Versioned v2 data/config layer coexisting with v1 during transition.
- Per-model entries carrying free/non-free variants across providers with costs.
- Task -> model id references.
- One shared base selection logic across plugin, extension and action.
- Runtime selection driven by task, model and provider availability, with free-first/go-first.
- Engine-provider precedence over external providers on equal factors.

**Non-Goals:**

- Migrating every maintenance data source at once.
- Redesigning the OpenChamber status UI beyond the README split.
- Changing host or SDK contracts.

## Decisions

**D1 — v1+v2 coexistence.** Maintenance writes both artifacts during transition; readers prefer v2 and fall back to v1.

**D2 — Task -> model id.** Task entries in v2 reference a single model id; variant lists live in the model registry.

**D3 — Variants.** Each v2 model entry carries `{provider, model, free, cost}` variants.

**D4 — Ordering.** Variants are ordered by score desc, cost asc; on equal cost+score the engine provider variant wins.

**D5 — Runtime preference.** free-first or go-first is applied at selection time, not from static task entries.

**D6 — Documentation split.** README keeps a short project description plus links; model/provider tables move to referenced Markdown files.

## Risks / Trade-offs

- Dual-write complexity in the maintenance script.
- Semantic drift between v1 tier logic and v2 runtime preference.
- Tie-break only applies on exact cost+score equality.
