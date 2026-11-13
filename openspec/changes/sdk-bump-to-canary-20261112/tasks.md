# Tasks

## 1. Dependency

- [ ] 1.1 Bump `@openchamber/sdk` to `2.7.1-canary.20261112.17` in `openchamber-modelselect/package.json` and verify `bun install` succeeds
- [ ] 1.2 Update `engines.openchamber` to `>=2.7.1` and verify the manifest parses
- [ ] 1.3 Rebuild `service/main.js`, `panel/main.js` and `background/main.js` and verify the committed bundles match their sources

## 2. Verification

- [ ] 2.1 Run `bun run check` and verify it passes
- [ ] 2.2 Run `bun run test` and verify all test files pass
- [ ] 2.3 Verify the new SDK surface type-checks against the manifest (`contributes.links`, `contributes.providerLogos`, `sessionControl.answers`)
- [ ] 2.4 Refresh the SDK snapshot in `.opencode/.modelselect-cache/release-watch.json` and verify the daily job reports the new version
- [ ] 2.5 Document the pin and the canary reason in `openchamber-modelselect/README.md`
