# Tasks

## 1. State model

- [ ] 1.1 Add `presenceState()` to the service (inputs: delivery, newest pick
      age, active sessions, entry evidence) with the ladder from design D2;
      verify a table-driven test covers every state and the "pick wins" rule.
- [ ] 1.2 Replace `pluginEntry()` and the `plugin-missing` / `no-pick` branches
      in `readView()` with the new state; verify the existing service tests pass
      or are updated with the reason.
- [ ] 1.3 Introduce one `STALE_AFTER_MS` used by both the presence state and the
      `Updated` badge; verify the "just now" and "not running" combination is
      impossible in a test.

## 2. Rendering

- [ ] 2.1 Render the presence state as a `note` row with the tone per design D5
      and the two-cause message; verify `guestStatusViewSchema` validation in the
      test matrix.
- [ ] 2.2 Show the evidence in the `Updated` row (fresh / last pick at T / no
      pick since install); verify the tooltip text matches the state test
      fixtures.
- [ ] 2.3 Route the card text through the same verdict
      (`createServiceHost().needsConfiguration`), replacing the fixed "add it to
      the managed config" sentence; verify a test asserts the message per state
      and that no state claims a missing entry for a delivered plugin.

## 3. Without the OpenCode role

- [ ] 3.1 Collapse `not-running`/`no-pick` when the role is absent and state
      less; verify a test asserts the reduced message and no invented cause.
- [ ] 3.2 Document the state table, the evidence and the reduced mode in
      `openchamber-modelselect/README.md`; verify the table matches the code's
      state names.

## 4. Verification

- [ ] 4.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`;
      verify all four test files pass.
- [ ] 4.2 Add the `CHANGELOG.md` entry (new presence states, no false
      "installed"); verify the version matches `package.json`.

## Workflow follow-up

- Archive the change after review, and sync the `plugin-presence` spec.
