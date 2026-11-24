# Proposal

## Why

The canary adds capability to switch a new-session draft between Session and Lead. Previously, drafts could only start in Session mode; users had to manually move them to a Lead or create a separate Lead session. This UX improvement makes the lead-creation flow more fluid.

## What Changes

- Add a UI control on new-session creation to choose Session or Lead as the initial mode.
- When Lead is chosen, the draft is automatically associated with a Lead session rather than a regular Session.
- The session list and picker show the distinction clearly.
- Fall back to Session-only mode on hosts without the lead capability.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.1` (not yet released; canary-only).

## Capabilities

### New Capabilities

- `lead-draft-session-switch`: new-session drafts can start as Lead instead of Session.

### Modified Capabilities

- `leads-sessions-direction-of-work`: lead hierarchy now includes draft-switching in its UX.

## Impact

- `openchamber-modelselect/service/src/main.js`, panel, README.
- Depends on `leads-sessions-direction-of-work-canary`.