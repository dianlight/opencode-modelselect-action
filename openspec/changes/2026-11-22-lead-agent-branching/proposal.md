# Proposal

## Why

The canary extends leads to support agent branching to sessions and digest replies as cards. Previously, leads were flat sessions with no branching or digest visualization. This UX upgrade makes lead work more structured and visible in the status section.

## What Changes

- SDK exposes lead session branching to its own sessions.
- Lead sessions can have sub-sessions that are agent-managed.
- Digest replies show as cards with lead call references.
- Status section shows lead calls as cards with digest summary.
- Fallback to flat session behavior on older hosts.

## Minimum OpenChamber SDK version

- Stable: OpenChamber `>=2.8.0` (released 2026-11-22).

## Capabilities

### New Capabilities

- `lead-agent-branching`: lead sessions can branch to their own agent sessions.
- `lead-digest-one-reply`: digest replies render as cards with lead call references.

### Modified Capabilities

- `leads-sessions-direction-of-work`: lead hierarchy now includes agent branching and digest cards.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/store.js`, panel, tests.
- Depends on `lead-draft-session-switch` and `leads-sessions-direction-of-work-canary`.