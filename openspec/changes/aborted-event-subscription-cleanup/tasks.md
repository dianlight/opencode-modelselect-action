# Tasks

## 1. Abort contract

- [ ] 1.1 Add a sim scenario that aborts a shared event subscription and verify no retry timer remains

## 2. Consumers

- [ ] 2.1 Remove outliving retry TTLs in `plugin/src/shared/usage.js` and verify late events are ignored by status and quota consumers

## 3. Documentation

- [ ] 3.1 Document abort cleanup in the extension README and verify the `>=2.8.1` floor
