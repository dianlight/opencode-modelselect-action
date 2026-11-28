# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/store.js`, `openchamber-modelselect/panel/src/plugin-tab.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Consume the host's loaded-plugin signal instead of parsing the managed config.
- Remove the JSONC tokenizer and config text-replacement path in `service/src/store.js`.

**Non-Goals:**

- Changing plugin installation itself.
- Changing model picks or task detection.

## Decisions

- Prefer the host signal over file parsing — alternatives: keep the tokenizer (rejected, brittle across JSONC edits).
- Retain `needsConfiguration` for the switched-off case documented in `plugin-switched-off-state`.

## Risks / Trade-offs

- Hosts below the floor lack the signal → gate on the canary floor and keep the current path temporarily.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
