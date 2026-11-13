# Proposal

## Why

OpenChamber 2.7.2 lets an extension style a tool's result as a card with
`contributes.tools` and `output: "card"`. The modelselect extension exposes the
current pick only through the Work Status section and the Models tab; an agent
that calls a `modelselect_status` tool (added to the shipped plugin) would see
the pick rendered as a card in the chat instead of raw JSON.

## What Changes

- Add a `modelselect_status` tool to the shipped OpenCode plugin returning the
  current pick (task, tier, model, Think, Jev reason, Source, Updated).
- Declare a `contributes.tools` rule matching `modelselect_status` with
  `output: "card"` and a `card` template for label/title/status/fields.
- Add the tool to the plugin's test suite and document it in the README.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.2-canary.20261113.19`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `modelselect-pick-card`: the tool and the card that renders it.

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js` (tool registration), `openchamber-modelselect/package.json`
  (manifest), tests, README.
- Depends on `sdk-bump-to-canary-20261113` and `ship-plugin-inside-extension`.
