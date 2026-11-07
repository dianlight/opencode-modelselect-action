# Tasks

## 1. Shared option source

- [ ] 1.1 Add `core/options-source.js` (read, validate per key, mtime cache,
      precedence merge) with Node tests; verify `mise run build-core` copies it
      into both vendors and `mise run build-core-check` passes.
- [ ] 1.2 Wire `plugin/src/v2.js` to merge the file over `ctx.options`; verify a
      test covers file-wins, entry-only, and missing-file cases.
- [ ] 1.3 Document the precedence in `plugin/README.md`; verify the text matches
      the tests' expectations.

## 2. Panel writes the file

- [ ] 2.1 Move the `/config` save in the service to write
      `~/.config/openchamber/modelselect.json` (read-modify-write, unknown keys
      preserved, `0600` on create); verify a service test asserts the file
      content and that no managed-config write happens.
- [ ] 2.2 Keep the secret fields write-only and the Save button gated on a real
      change; verify the existing panel-frame test still passes with every
      request forwarded to the service.
- [ ] 2.3 Merge legacy entry values into the file on the first save; verify a
      fixture with an entry holding options produces a complete file and an
      untouched entry.

## 3. Remove the reload workaround

- [ ] 3.1 Delete `RELOAD_PATH`, `reloadPorts()`, `postJson()`,
      `reloadOpenCode()` and the reload branches from
      `service/src/main.js`; verify no reference remains and the service unit
      tests pass.
- [ ] 3.2 Remove the "restart required" copy and the reload-only control from
      the panel; verify `panel-frame` tests pass without the reload fixture.
- [ ] 3.3 Confirm the panel still declares no `files` capability or filesystem
      paths and that `bun run check` accepts the manifest; verify no reload
      endpoint string remains anywhere in the tree.

## 4. Documentation and release

- [ ] 4.1 Rewrite the `modelselect.json` section on
      `openchamber-modelselect/README.md` (option keys, precedence, secrets,
      mtime reload) and the Plugin-tab paragraph that describes the managed
      entry; verify every documented key exists in the parser test.
- [ ] 4.2 Rebuild `service/main.js` and `panel/main.js`, run `bun run check` and
      `bun run test`; verify all four test files pass.
- [ ] 4.3 Add the `CHANGELOG.md` entry (removal of the reload guess, new file
      source); verify the version matches `package.json`.

## Workflow follow-up

- Archive the change after review, and sync the `plugin-configuration` spec.
