# Proposal

## Why

OpenChamber 2.8.2-canary.20261128.34 adds sidebar folder actions and folder inheritance. Model defaults currently live only at session or project scope, so a folder of related projects cannot share a routing choice.

## What Changes

- Add folder-scoped model, thinking and agent defaults to the routing store.
- Expose a folder action that applies those defaults to descendant sessions.
- Define inheritance precedence: session, then folder chain, then project.

## Out of Scope

- Changing global or per-project defaults.
- Reordering sidebar marks.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261128.34`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `folder-scoped-model-defaults`: defines model defaults and actions scoped to a sidebar folder and inherited by its children.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/store.js`
- `openchamber-modelselect/service/src/main.js`
- `openchamber-modelselect/package.json`
- `plugin/src/v2.js`
