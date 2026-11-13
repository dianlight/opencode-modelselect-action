# Tasks

## 1. Dependency

- [x] 1.1 Bump `@openchamber/sdk` to `2.7.1-canary.20261109.13` in `openchamber-modelselect/package.json`. — superseded: the pin landed on stable `2.7.1` instead (see `2026-11-13-adopt-session-control-answers`).
- [x] 1.2 Reinstall, rebuild `service/main.js`, `panel/main.js`, `background/main.js`. — done: all three are rebuilt against SDK `2.7.1`.
- [x] 1.3 Run the four test files. — done: the suite is green (83 tests).

## 2. Manifest

- [x] 2.1 Update `engines.openchamber` to `>=2.7.0`. — superseded: the floor is `>=2.7.1`, the first release with the `sessionControl.answers` grant.

## 3. Docs

- [x] 3.1 Refresh the SDK snapshot in the release-watch state. — done: the state records latest `2.7.1` and canary `2.7.2-canary.20261113.19`.
- [x] 3.2 Document the pin and the canary-pin reason in `openchamber-modelselect/README.md`. — done: the README names the pin and why it is a stable one, not a canary.
