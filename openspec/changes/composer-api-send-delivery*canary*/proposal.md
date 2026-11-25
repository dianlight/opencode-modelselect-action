# Proposal

## Why

OpenCode 2.4.0 adds `composer.send(commentID)` and `composer.delivery()` to the
GUI composer API, letting an extension send a queued comment and track its
delivery state. The modelselect extension has no message-delivery tracking today:
queued picks and mentions are fire-and-forget, so a failed delivery is silent.

## What Changes

- Use `composer.send(commentID)` when dispatching a modelselect pick or mention
  as a composer chip.
- Use `composer.delivery()` to track delivery status and surface failures in the
  Work Status section.
- Add retry handling for failed deliveries.
- Add tests for send/delivery flow.

## Out of Scope

- Building a full message queue.
- Changes to the host composer runtime.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261125.31`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `composer-api-send-delivery`: modelselect tracks composer message delivery.

### Modified Capabilities

- `mention-attach-context`: delivery tracking for attached context.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/view.js`, tests.
- Panel/background composer integration.
