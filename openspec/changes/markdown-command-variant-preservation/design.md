# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/commands/`, `openspec/changes/ship-modelselect-skills/proposal.md`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- Ship a model-selection Markdown command with both `model` and `variant` frontmatter.
- Add a regression check that a command keeps the thinking variant beside the model.

**Non-Goals:**

- Adding commands for unrelated workflows.
- Changing the picker UI.

## Decisions

- Ship explicit frontmatter rather than relying on host defaults — alternatives: compute variant at runtime (rejected, not available for Markdown commands).
- Coordinate with `ship-modelselect-skills` instead of superseding it.

## Risks / Trade-offs

- The project has no commands directory yet → create it as part of implementation.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
