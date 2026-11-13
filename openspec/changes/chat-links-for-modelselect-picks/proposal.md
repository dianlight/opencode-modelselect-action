# Proposal

## Why

OpenChamber 2.7.1 lets an extension declare `contributes.links` so identifiers
and URLs in chat messages become clickable and either open the extension or
attach as a composer chip. Modelselect picks (task, tier, model) are currently
invisible in chat unless the user opens the section.

## What Changes

- Declare `contributes.links` with identifier keys for task types (e.g. task
  codes) and URL templates pointing at the modelselect page.
- Handle `GuestLinkItem` in the panel/background to show the pick for the
  clicked identifier.
- Add the `links` capability to the approval flow.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261110.14`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `chat-links-for-picks`: which identifiers are claimed and what opens.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest, capabilities), panel,
  background, tests.
- Depends on `sdk-bump-to-canary-20261113`.
