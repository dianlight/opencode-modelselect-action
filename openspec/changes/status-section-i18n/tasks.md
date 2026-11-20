# Tasks

## 1. Locale plumbing

- [ ] 1.1 Read `locale` from the `GET /status` query string in `service/src/main.js` and pass it in the snapshot, and verify the service test observes the value reaching the view.
- [ ] 1.2 Define a locale-keyed message table module with English as the base table, and verify unknown keys resolve to English.

## 2. View localization

- [ ] 2.1 Replace fixed strings in `service/src/view.js` (labels, tooltips, badges, notes and the router control) with table lookups, and verify the view test still passes `guestStatusViewSchema`.
- [ ] 2.2 Add a second locale table for at least one non-English locale, and verify a localized render changes the chrome strings but not the row ids or data values.

## 3. Verification

- [ ] 3.1 Add cases for supported, unsupported and missing locales plus a long translation, and verify truncation respects every schema field limit.
- [ ] 3.2 Document the locale behavior in the extension README and verify the documented query parameter matches the service code.
