# Proposal

## Why

OpenCode 2.4.0 adds MCP Events beta: a pull-based event subscription channel that
opens a long-lived connection to a server, sends the request over WebSocket with
`experimental/mcp/session/request`, and receives events pushed by the server. This
removes polling for the modelselect quota provider — instead of probing
`usage-limits.json` on an interval, the extension can subscribe to quota reset
events from providers that push them.

## What Changes

- Add a quota event source: when a provider sends an MCP event, trigger a
  `usage-limits.json` refresh.
- Use `readMcpSessionRequest` and `readMcpSessionEvent` from the SDK for
  event subscription.
- Check `protocol` setting compatibility before subscribing.
- Fall back to polling when the provider does not support MCP events.

## Out of Scope

- Sending MCP events (the extension is a client, not a server).
- MCP events for the modelselect extension's own session hooks.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261124.30`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `opencode-mcp-events-quota`: quota data updated via MCP events when available, with polling fallback.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`.

## Safe to Revert

Remove the MCP event subscription and fall back to polling on every check.
