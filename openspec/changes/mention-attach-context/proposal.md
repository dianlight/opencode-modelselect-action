# Proposal

## Why

OpenChamber 2.7.3 renders attached context as one row per item in the composer
and as quotes in the sent message (chat quotes, review comments, browser
annotations, terminal selections, PR items), and opens a text file's chip in the
composer. The modelselect mentions surface resolves a mention to a short context
text block; under the new attach model that block becomes an attached context
row and a quote, so the extension's resolve output and row titles must match the
new row/quote shape and limits.

## What Changes

- Update `MENTIONS_SEARCH_PATH`/`MENTIONS_RESOLVE_PATH` rows so their titles and
  resolved text fit the composer's context rows and the sent-message quote.
- Open a resolved model/task/pick reference as a chip in the composer where the
  host supports it (text file chips), not only as inline text.
- Validate against the SDK's row/quote limits and add tests.

## Out of Scope

- Changing which rows are offered.
- Chat-side rendering (host-owned).

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261116.22`.
- Stable: OpenChamber `>=2.7.3`.

## Capabilities

### New Capabilities

(none — adapts mentions to the new attach shape.)

### Modified Capabilities

- `mentions-integration`: row/quote shape and chip behavior.

## Impact

- `openchamber-modelselect/service/src/main.js`, tests, README.
- Rebuilt `service/main.js`.
