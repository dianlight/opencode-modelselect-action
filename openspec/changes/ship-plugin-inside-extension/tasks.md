# Tasks

## 1. Plugin bundle

- [ ] 1.1 Add `build:plugin` (single-file CJS from `plugin/src/v2.js`, core
      folded in) and wire it into `openchamber-modelselect`'s `build` script;
      verify the output has no `require(` of a relative or package path.
- [ ] 1.2 Commit `openchamber-modelselect/plugin/index.js` and add a test that
      fails when it is not the current build; verify the test fails after
      touching `plugin/src/v2.js` and passes after rebuilding.

## 2. Manifest and delivery

- [ ] 2.1 Declare `contributes.opencodePlugin: "plugin"`, bump `version`, and
      verify `bun run check` accepts the folder and its entry.
- [ ] 2.2 Replace `pluginEntry()`'s config grep with the host delivery state and
      the fresh-status check; verify unit tests cover `file`, `restart`, `none`,
      `remote`, and "delivered but no status file".
- [ ] 2.3 Rebuild `service/main.js` and `panel/main.js`; verify `bun run check`
      and `bun run test` pass.

## 3. Stop writing the plugin entry

- [ ] 3.1 Remove the managed-config `modelselect` entry save from the service's
      `/config` POST and from `panel/src/plugin-tab.js`; verify no code path
      writes `~/.config/openchamber/opencode.managed.json` any more.
- [ ] 3.2 Add the leftover-entry detection and the one-time removal action;
      verify a fixture config with an old entry produces the note and that the
      action removes only that entry.
- [ ] 3.3 Verify the panel and the manifest still declare no `files` capability
      and no filesystem paths after the change, and that `bun run check` accepts
      the manifest.

## 4. Documentation and release

- [ ] 4.1 Rewrite "Fix hint (plugin-missing)" in
      `openchamber-modelselect/README.md` around delivery states and the
      duplicate-load notice; verify the wording matches the rendered rows.
- [ ] 4.2 Update root `README.md` (one-install story) and `CHANGELOG.md`;
      verify the version and the entry text agree.
- [ ] 4.3 Verify a clean install on OpenChamber canary loads the plugin and
      Settings → Plugins lists it; verify disable removes it and enable brings
      it back.

## Workflow follow-up

- Archive the change after review, and sync the `plugin-distribution` spec.
