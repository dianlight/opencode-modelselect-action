# Tasks

## 1. Row model

- [ ] 1.1 Add `ROW_PRIORITY` and a single trim step to
      `service/src/view.js`; verify a test with 18 rows drops the lowest two and
      keeps Task/Tier/Model/Think.
- [ ] 1.2 Add the `ROW_ICONS` map and emit `icon` per row; verify a test asserts
      every emitted name is in the map and no unknown name reaches the answer.
- [ ] 1.3 Document the row order and the drop order in
      `openchamber-modelselect/README.md`; verify the list matches the test
      fixtures.

## 2. Header control

- [ ] 2.1 Move the router switch from a `line` to `controls` and keep the
      `routing-sync` `POST` handler; verify a service test posts `off`, reads
      back, and sees `checked: false`.
- [ ] 2.2 Remove the "switch is always last" rule and its comment; verify no
      test depends on the switch being a row.

## 3. Trend

- [ ] 3.1 Add the per-project ring buffer (≤120) fed by each quota reading and
      pass the series into the builder; verify a test serves five readings and
      asserts five chart values in order.
- [ ] 3.2 Render the sparkline with `step` equal to the poll interval and the
      bar's unit; verify the answer validates against
      `guestStatusViewSchema`.

## 4. Verification

- [ ] 4.1 Add the schema-check matrix test (no data, Go only, budgets, notes,
      latched free tier); verify it fails when a field is deliberately broken.
- [ ] 4.2 Rebuild `service/main.js`, run `bun run check` and `bun run test`;
      verify all four test files pass.
- [ ] 4.3 Add the `CHANGELOG.md` entry (switch moved, icons, trend, drop order);
      verify the version matches `package.json`.

## Workflow follow-up

- Archive the change after review, and sync the `status-section` spec.
