# Design

## Context

See `proposal.md` for motivation. SDK `2.7.2` exposes `icon` on line rows and a
strict `controls` array that accepts `button` and `select` (not `switch`), so the
On/Off segmented content currently in the router row must become a `select`
control in the header. The service already accepts a `routing-sync` control
event with `on`/`off` values, so no handler change is required.

## Goals / Non-Goals

**Goals:**

- Make fixed rows scannable through icons.
- Free one row by moving the router control to the header.

**Non-Goals:**

- Redesigning the panel or the host renderer.
- Changing what the control does.

## Decisions

- Use static icon names chosen from the host's Remixicon set and validate them
  against `GUEST_STATUS_VIEW_ICON`.
- Use a `select` header control because the header schema has no `switch`; keep
  the `routing-sync` id and `on`/`off` values so the existing handler is reused.
- Keep the icon-only on fixed rows; latch notes stay notes because the note row
  schema has no icon field.
- Preserve the existing row drop order when the cap is reached.

Alternatives considered: keeping the segmented control (rejected, it wastes a
row) and an emoji label (rejected, the SDK contract asks for icon names).

## Risks / Trade-offs

- A chosen icon name may not render in an older host → Mitigation: the engine
  floor is `>=2.7.2`, where icons are part of the contract.
- Header controls render differently from inline controls → Mitigation: assert
  the control id and values in the view test rather than pixel appearance.

## Migration Plan

No data migration; row and control ids stay stable. Apply, update view tests,
archive.

## Open Questions

(none)
