# Tasks

## 1. Readiness contract

- [ ] 1.1 Add a sim scenario where an action runs during app startup and verify it runs once after readiness

## 2. Remove guessing

- [ ] 2.1 Remove `reloadPorts()` and its callers in `service/src/main.js` and verify no hard-coded port remains
- [ ] 2.2 Verify a throttled wake inside the window still performs no refresh

## 3. Documentation

- [ ] 3.1 Document the readiness behavior in the extension README and verify the manifest has no stale reload guidance
