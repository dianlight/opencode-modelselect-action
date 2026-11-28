# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `plugin/src/shared/runtime-catalog.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Read context and completion limits from the gateway model list before falling back.
- Remove the hard-coded virtual-limit constants from `plugin/src/v2.js`.

**Non-Goals:**

- Changing model selection scores or task types.
- Changing gateway authentication.

## Decisions

- Prefer gateway metadata over curated YAML — alternatives: expand `model-capabilities.yaml` (rejected, duplicate source).
- Keep the runtime catalog miss ledger for observability.

## Risks / Trade-offs

- Gateways that omit the fields still need a fallback → mark it explicitly in status.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
