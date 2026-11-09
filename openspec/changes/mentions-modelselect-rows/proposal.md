# Proposal

## Why

OpenChamber 2.7.0 exposes `MENTIONS_SEARCH_PATH` and `MENTIONS_RESOLVE_PATH` so an
extension can add rows to the composer's `@` menu and resolve them to context text.
This project exposes no such rows today, so a user cannot reference a model, a task
type, or the current pick from a prompt; the only way to surface them is the
Work Status section or the Models tab.

## What Changes

- Serve `/mentions/search` and `/mentions/resolve` from `openchamber-modelselect/service/src/main.js`.
- Search returns up to 20 rows: task types from `model-config-cache.json`, models from
  the chain preview, and the current pick, filtered by the query.
- Resolve returns a short text block the agent reads with the message (task, tier,
  model, Think, Jev reason).
- Validate row titles/ids against the SDK limits (`MENTION_TITLE_MAX`, `MENTION_ID_MAX`,
  `MENTION_TEXT_MAX`) and the 2 s search timeout.
- Document the new surface in `openchamber-modelselect/README.md`.

## Capabilities

### New Capabilities

- `mentions-integration`: which rows the extension adds, how they are searched and
  resolved, and the size/time limits it respects.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js`, `chain.js`, tests.
- Rebuilt `service/main.js`; no new permission (service loopback routes).
- Depends on `sdk-bump-to-2.7.1`.
