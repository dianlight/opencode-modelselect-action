# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/package.json`, `openspec/changes/sdk-surface-audit-2-7-3/proposal.md`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Audit the `@openchamber/sdk` 2.8.1 surface used by the extension and plugin.
- Update minimum versions and remove workarounds that 2.8.1 makes unnecessary.

**Non-Goals:**

- Adopting the 2.8.2 canary features.
- Changing the model scoring pipeline.

## Decisions

- Use the stable SDK surface as the baseline — alternatives: keep auditing 2.7.3 (rejected, stale).
- Keep canary-only work in its own `-canary` changes.

## Risks / Trade-offs

- 2.8.1 is released → floor `>=2.8.1` and no canary dependency for this audit.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
