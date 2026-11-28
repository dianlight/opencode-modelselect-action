# Design

## Context

See `proposal.md` for motivation. The relevant host surface must be available at
the declared minimum version. The shipped code lives in `openchamber-modelselect/service/src/main.js`, `plugin/src/shared/core/routing.js`;
the service remains the only owner of file I/O and the panel talks to it through
`panel/src/api.js`.

## Goals / Non-Goals

**Goals:**

- React to provider removal and purge that provider's routing entries, cached catalog state and logos.
- Cancel quota probes and in-flight failover attempts targeting the removed provider.

**Non-Goals:**

- Removing a model from the model registry.
- Changing the Settings provider editor itself.

## Decisions

- Use the host removal event as the trigger — alternatives: polling the config file (rejected, racy).
- Keep the plugin cache as the only source of provider names, never a hard-coded list.

## Risks / Trade-offs

- Removal during an in-flight turn may interrupt it → fail over rather than failing the turn.

## Migration Plan

Apply with the declared minimum version, add the sim scenarios listed in
`tasks.md`, verify `npm run sim` passes, then archive the change.

## Open Questions

(none)
