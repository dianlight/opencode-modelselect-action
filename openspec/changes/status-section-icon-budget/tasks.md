# Tasks

## 1. Row icons

- [ ] 1.1 Add schema-valid Remixicon names to the fixed line rows in `service/src/view.js`, and verify `test/status-view.test.cjs` passes `guestStatusViewSchema` with every icon present.

## 2. Header control

- [ ] 2.1 Replace the inline `routing-sync` segmented row with a top-level `controls` select using the same id and `on`/`off` values, and verify the view has one fewer row and no duplicate control id.
- [ ] 2.2 Exercise the header control through the service control endpoint and verify the router-sync file changes as it did with the inline switch.

## 3. Budget and docs

- [ ] 3.1 Add a cap test with many budget windows and verify the header control survives and rows never exceed the SDK maximum.
- [ ] 3.2 Document the icons and header control in the extension README and verify the documented behavior matches the view output.
