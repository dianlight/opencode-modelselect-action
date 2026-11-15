# Proposal

## Why

OpenChamber 2.7.3 ships Agent Pages: an agent can render a page in chat, ask the user to answer on it, and share it with teammates by link and PIN. The modelselect extension already has a full-page view and a pick action; exposing the model comparison as an agent page lets the agent ask a teammate which model to use and collect the answer in-session.

## What Changes

- Add a skill/rule telling the agent to render model comparisons as an agent page when a decision needs a teammate.
- Ensure the modelselect full-page view works when opened as a shared page (read-only answer controls where applicable).
- Document the page flow in the extension README.

## Out of Scope

- Implementing the sharing service (host-owned).
- Changing the model routing logic.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261115.21`.
- Stable: OpenChamber `>=2.7.2`.

## Capabilities

### New Capabilities

- `modelselect-agent-page`: model comparison page shared for teammate decisions.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect` skills/docs, full-page view, tests.