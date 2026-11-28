# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/package.json`, `openspec/changes/chat-links-for-modelselect-picks/proposal.md`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Declare gateway link origins with subdomain wildcards.
- Extend `chat-links-for-modelselect-picks` to cover gateway subdomains without listing each host.

**Non-Goals:**

- Changing link destinations themselves.
- Changing the SDK manifest schema.

## Decisions

- Prefer wildcard origins over enumerating hosts — alternatives: generate entries at build time (rejected, stale).
- Keep exact origins where a subdomain must be excluded.

## Risks / Trade-offs

- Hosts below the floor reject wildcards → gate on the canary floor.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
