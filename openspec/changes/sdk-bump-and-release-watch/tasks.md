# Tasks

## 1. Bump the SDK

- [ ] 1.1 Pin `@openchamber/sdk` to `2.6.2-canary.20261107.11` in
      `openchamber-modelselect/package.json`, run `bun install`, and verify
      `bun.lock` records the new version.
- [ ] 1.2 Rebuild all three bundles (`bun run build`) and verify `bun run check`
      passes `node --check` plus `openchamber-guest-check`.
- [ ] 1.3 Run `bun run test` (status-view, chain, status-service, panel-frame,
      manifest) and confirm the suite is green on the new types.

## 2. Surface watch

- [ ] 2.1 Extend `scripts/release-watch.js` to `npm pack` the new SDK version
      into a temp directory and extract `## ` headings from
      `GUEST_SERVICES.md`, `API.md` and `DOCUMENTATION.md`; verify a unit test
      against two fixture tarballs reports one added and one removed heading.
- [ ] 2.2 Store the snapshot as `sdkDocs` in
      `.opencode/.modelselect-cache/release-watch.json`, keeping three versions;
      verify the state file after two simulated runs keeps both and drops the
      oldest on the fourth.
- [ ] 2.3 Print the added and removed headings under the existing SDK report
      line, naming the file and the section; verify the output of a simulated
      run with the `.10` and `.11` fixtures names `OpenCode access`.

## 3. Documentation

- [ ] 3.1 Document the pin, why it is a canary pin, and what to run after a bump
      in `openchamber-modelselect/README.md`; verify the commands run as written.
- [ ] 3.2 Describe the doc-heading diff and the one-time full report on a fresh
      state file in the script header; verify the header matches the code paths.
- [ ] 3.3 Add the `CHANGELOG.md` entry naming the SDK version and the new
      release-watch signal; verify the version matches `package.json`.

## Workflow follow-up

- Archive the change after review. No spec delta: this change moves a dependency
  and the tooling that watches it (`skip_specs: true`).
