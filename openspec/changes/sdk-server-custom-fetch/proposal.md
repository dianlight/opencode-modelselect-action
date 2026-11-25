# Proposal

## Why

OpenCode 2.2.6 lets server embedders provide a custom `fetch` implementation for
OpenCode HTTP, model, web, and remote MCP traffic. The modelselect extension
service uses the default fetch, which cannot route through proxies or custom
transports needed for remote/tunneled deployments.

## What Changes

- Allow the extension service to accept a custom `fetch` implementation via
  configuration.
- Pass the custom fetch to OpenCode SDK calls (HTTP, model, web, remote MCP).
- Document the configuration option.
- Add tests for custom fetch usage.

## Out of Scope

- Implementing specific proxy transports.
- Changes to the host fetch runtime.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `sdk-server-custom-fetch`: extension supports custom fetch.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, config, tests.
- Documentation in README.
