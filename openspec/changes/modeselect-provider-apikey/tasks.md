# Tasks

## 1. Auth resolution

- [ ] 1.1 Add `modeselect` as the first entry in `PROVIDER_IDS` in `plugin/src/shared/auth.js` and verify `readAuthToken` returns a `modeselect` key when present
- [ ] 1.2 Update `resolveToken` so a stored Modeselect key wins over `OPENCODE_API_KEY`, while the explicit option still wins and other auth providers remain fallbacks; verify with unit tests
- [ ] 1.3 Update `plugin/test/auth.test.js` for the new provider id and precedence; verify `node --test` passes

## 2. Integration registration

- [ ] 2.1 Add a guarded `ctx.integration.transform` block in `plugin/src/v2.js` that registers the `modeselect` integration with `key` and `env` (OPENCODE_API_KEY) methods; verify the plugin still loads when the transform is unsupported
- [ ] 2.2 Ensure registration failures are logged only in verbose mode and never break setup; verify by simulating a throwing transform

## 3. Verification

- [ ] 3.1 Run `node --test plugin/test/auth.test.js` and confirm all cases pass
- [ ] 3.2 Run `node --check plugin/src/v2.js` and `node --check plugin/src/shared/auth.js`

## Workflow follow-up

- Archive the change after review requirements are satisfied.
