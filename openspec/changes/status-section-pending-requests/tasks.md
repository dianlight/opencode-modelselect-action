# Tasks

## 1. Events

- [ ] 1.1 Subscribe to `permission-asked` and `question-asked` session events.
- [ ] 1.2 Keep a per-project count of pending requests in the service data folder.

## 2. View

- [ ] 2.1 Add a `pending` row with the count and, when allowed to answer, a control.
- [ ] 2.2 Drop the count first under the 16-row cap, after notes and budget models.
- [ ] 2.3 Clear entries on settle, `turn-finished`, `turn-failed`.
- [ ] 2.4 Validate the new row against `guestStatusViewSchema`.

## 3. Verification

- [ ] 3.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
