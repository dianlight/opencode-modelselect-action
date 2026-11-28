# Tasks

## 1. Event classification

- [ ] 1.1 Add a sim scenario with a compaction-only session event and verify no announcement or status write occurs

## 2. Suppression

- [ ] 2.1 Gate `formatAnnounce` and status file writes in `plugin/src/v2.js` and the service on the classification, and verify a normal turn still emits both

## 3. Documentation

- [ ] 3.1 Document the silent-turn rule in the extension README and verify it matches the 11-28 canary note
