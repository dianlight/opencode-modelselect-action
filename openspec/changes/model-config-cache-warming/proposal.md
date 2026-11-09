# Proposal

## Why

The canary pings a warm session just before its model's cache expires ("warming:
ping a warm session just inside its model's cache lifetime"). This project's
service reads `model-config-cache.json` on demand and its `maintain()` timer runs
every 60 s; a cold read after cache expiry costs a disk parse and a stale answer
until the next sync.

## What Changes

- Track the cache's age in the service and refresh it proactively before expiry,
  reusing the warming cadence.
- Keep the on-demand read as the fallback.
- Document the refresh cadence in the README.

## Capabilities

### New Capabilities

- `model-config-cache-warming`: when and how the cache is refreshed.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/service/src/main.js` (`maintain`, `readCatalog`), tests.
- Rebuilt `service/main.js`.
- Depends on `sdk-bump-to-2-7-1`.
