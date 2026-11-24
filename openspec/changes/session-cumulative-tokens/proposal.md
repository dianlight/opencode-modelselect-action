# Proposal

## Why

Stable 2.8.0 exposes cumulative session usage (`tokens: { prompt, output, reasoning,
cacheRead, cacheWrite, cacheHitPercent }`) on session records and on
`ready.session`/`onSession`, in addition to the per-step `context` fill. The
existing `session-context-token-usage` spec only covers context fill, so the
extension cannot show cumulative session cost without a second projection.

## What Changes

- Extend the `sessionRecord` projection to include cumulative `tokens` alongside
  `context`, tolerating missing fields on older hosts.
- Use cumulative tokens in the per-session row and the `model-pick` action.
- Keep context fill as the per-step measure; tokens as the session total.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261122.28`.
- Stable: OpenChamber `>=2.8.0`.

## Capabilities

### New Capabilities

- `session-cumulative-tokens`: extension reads cumulative session token usage.

### Modified Capabilities

- `adopt-session-record-fields`: projection gains a cumulative tokens field.
- `session-context-token-usage`: superseded by this spec.

## Impact

- `openchamber-modelselect/service/src/main.js`, `service/src/view.js`, tests.
- Supersedes `session-context-token-usage`.

## Out of Scope

- New UI surfaces.
- Host session-record changes.
