# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/package.json`, `openchamber-modelselect/package.json`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Allow the extension's plugin to be symlinked from its source tree during development.
- Remove the development-only copy step where the host resolves imports.

**Non-Goals:**

- Changing the published bundle layout.
- Adding new plugin runtime behavior.

## Decisions

- Use the host symlink resolution instead of a copy step — alternatives: keep copying (rejected, drift between source and bundle).
- Gate development docs on the canary floor; release behavior is unchanged.

## Risks / Trade-offs

- Symlink resolution is host-version dependent → verify both development and release paths in CI.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
