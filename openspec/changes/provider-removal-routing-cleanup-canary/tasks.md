# Tasks

## 1. Removal event

- [ ] 1.1 Add a sim scenario where Settings removes a configured provider and verify the service observes it

## 2. Cleanup

- [ ] 2.1 Purge the provider's routes, quota windows and cached catalog in `service/src/main.js` and `plugin/src/shared/core/routing.js`, and verify no stale pick remains
- [ ] 2.2 Verify a pick that used the removed provider fails over to the next valid variant

## 3. Documentation

- [ ] 3.1 Document provider-removal cleanup in the extension README and verify the panel no longer shows removed logos
