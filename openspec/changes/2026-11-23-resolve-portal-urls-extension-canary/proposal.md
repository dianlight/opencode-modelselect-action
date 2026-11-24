# Proposal

## Why

The canary lets extensions resolve portal URLs. The modelselect extension shows provider/model links in the panel and status section using hard-coded URLs; resolving them through the extension host keeps links correct across OpenChamber versions and remotes.

## What Changes

- Register portal URL resolvers for provider and model pages.
- Use resolved URLs in the panel and status section links.
- Fall back to the existing hard-coded URLs when resolution fails.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261123.29`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `resolve-portal-urls-extension`: extension resolves portal URLs through the host.

### Modified Capabilities

- `provider-logos-for-modelselect`: links use resolved portal URLs.

## Impact

- `openchamber-modelselect/panel/src/main.js`, `service/src/view.js`.
- `openchamber-modelselect/package.json` manifest.

## Out of Scope

- Adding new portal providers.