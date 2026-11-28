# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/README.md`, `plugin/README.md`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Document and test private Git sources for the extension and bundled plugin.
- Support SSH aliases and private-network hosts in the development setup without exposing credentials in bundles.

**Non-Goals:**

- Changing the published extension manifest.
- Adding credentials to committed artifacts.

## Decisions

- Keep credentials in the host's account selection — alternatives: embed tokens in URLs (rejected, leaks).
- Gate platform docs on the canary floor.

## Risks / Trade-offs

- Private hosts may be unreachable in CI → keep sim fixtures local and replayed.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
