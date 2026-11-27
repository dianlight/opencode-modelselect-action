# Proposal

## Why

OpenCode 2.4.0 removed the built-in `outline-pair` and `outline-steer` icons from
the extensions API. GUI plugins must now declare their own SVG icons through
`Plugin.define({ icons })` and consume them via `ctx.icons`. The modelselect
extension still references the removed built-in icons in its panel and Work
Status surfaces, so those surfaces render missing or fallback icons.

## What Changes

- Declare custom SVG icons for modelselect surfaces via `Plugin.define({ icons })`
  and reference them through `ctx.icons`.
- Replace all references to `outline-pair` and `outline-steer` with the new
  declared icons.
- Update panel and Work Status rendering to use the new icon names.
- Add tests covering icon registration and rendering.

## Out of Scope

- Redesigning the icon set beyond replacing removed ones.
- Changes to non-extension surfaces.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.1` (released 2026-11-26; graduated from the `2.8.1-canary` line).

## Capabilities

### New Capabilities

- `remove-outline-icons-from-extension`: modelselect declares its own icons.

### Modified Capabilities

- `status-section-polish`: Work Status icon references updated.

## Impact

- `openchamber-modelselect/panel/src/main.js`, `service/src/view.js`, tests.
- Extension manifest `package.json` icon declarations.
