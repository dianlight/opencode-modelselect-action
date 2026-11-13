# Tasks

## 1. Dependency

- [x] 1.1 Bump `@openchamber/sdk` to `2.7.1-canary.20261112.17` in `openchamber-modelselect/package.json` and verify `bun install` succeeds — superseded: the pin landed on stable `2.7.1` instead (see `2026-11-13-adopt-session-control-answers`), and `bun install --frozen-lockfile` succeeds.
- [x] 1.2 Update `engines.openchamber` to `>=2.7.1` and verify the manifest parses — done.
- [x] 1.3 Rebuild `service/main.js`, `panel/main.js` and `background/main.js` and verify the committed bundles match their sources — done.

## 2. Verification

- [x] 2.1 Run `bun run check` and verify it passes — done.
- [x] 2.2 Run `bun run test` and verify all test files pass — done (83 tests).
- [x] 2.3 Verify the new SDK surface type-checks against the manifest (`contributes.links`, `contributes.providerLogos`, `sessionControl.answers`) — done: all three parse under SDK `2.7.1`.
- [x] 2.4 Refresh the SDK snapshot in `.opencode/.modelselect-cache/release-watch.json` and verify the daily job reports the new version — done: the state records latest `2.7.1` and canary `2.7.2-canary.20261113.19`, and the script reports the move.
- [x] 2.5 Document the pin and the canary reason in `openchamber-modelselect/README.md` — done: the README names the pin and why it is a stable pin rather than a canary.
