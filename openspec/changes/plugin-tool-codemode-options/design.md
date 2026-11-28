# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `plugin/src/v2.js`, `openchamber-modelselect/package.json`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Declare `options.codemode` for the `model-pick` tool with a task-type and tier schema.
- Keep the non-Code-Mode tool surface unchanged.

**Non-Goals:**

- Adding new tool parameters beyond task type and tier.
- Changing the action labels in the manifest.

## Decisions

- Declare schema instead of inferring arguments — alternatives: prompt-side validation (rejected, not enforced).
- Keep `modelselect-pick-tool-card` active; this adds typed options.

## Risks / Trade-offs

- Hosts below 2.8.1 ignore the options → floor `>=2.8.1`.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
