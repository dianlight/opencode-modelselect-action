# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `openchamber-modelselect/package.json`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Let the plugin create, list and delete routing automations through the experimental automation API.
- Keep manifest cron entries for hosts without the API.

**Non-Goals:**

- Changing the schedule contract itself.
- Removing the service schedule entries.

## Decisions

- Prefer host automations where available — alternatives: local `setInterval` (rejected, always-on polling).
- Do not mark `opencode-automations-compat` outdated; this extends it.

## Risks / Trade-offs

- Experimental API may change → keep manifest fallback.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
