# Proposal

## Why

OpenChamber 2.8.2-canary.20261127.33 (PR 7621) accepts subdomain wildcards in `contributes.links.urls.origin`. `chat-links-for-modelselect-picks` currently lists gateway origins one by one, so gateway subdomains fail validation.

## What Changes

- Declare gateway link origins with subdomain wildcards.
- Extend `chat-links-for-modelselect-picks` to cover gateway subdomains without listing each host.
- Keep exact-origin entries for hosts that must not match subdomains.

## Out of Scope

- Changing link destinations themselves.
- Changing the SDK manifest schema.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.2-canary.20261127.33`.
- Stable: OpenChamber `>=2.8.2`.

## Capabilities

### New Capabilities

- `link-origin-matching`: defines how extension link origins match subdomain wildcards.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`
- `openspec/changes/chat-links-for-modelselect-picks/proposal.md`
- `openchamber-modelselect/panel/src/links-tab.js`
