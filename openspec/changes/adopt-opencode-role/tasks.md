# Tasks

## 1. Manifest and approval

- [ ] 1.1 Add `"opencode"` to `contributes.service.provides` in
      `openchamber-modelselect/package.json` and bump `version`; verify
      `bun run check` passes `openchamber-guest-check` with the new role.
- [ ] 1.2 Update the install/approval text in `openchamber-modelselect/README.md`
      (what the role reads, what it never does) and verify the README states the
      re-approval on update.

## 2. OpenCode client module

- [ ] 2.1 Add `service/src/host-opencode.js`: base URL + bearer from the
      environment, the six listed reads, no discovery, no port scan; verify unit
      tests cover "missing env → no request" and "403 → error, no fallback".
- [ ] 2.2 Assert the module never logs the URL or token and never writes; verify
      a test greps the error strings for the token value.

## 3. Snapshot and stream

- [ ] 3.1 Add `service/src/snapshot.js`: build from `/api/session` +
      `/api/session/active` filtered by directory, merge status files for the
      pick; verify unit tests cover a project with sessions and no status files.
- [ ] 3.2 Add the SSE subscriber with backoff, byte-cap reconnect and idle stop;
      verify a test drives a fake stream end and asserts one reconnect and an
      unchanged snapshot.
- [ ] 3.3 Wire `readView()` to the snapshot with the file path as fallback;
      verify the existing view tests pass unchanged and a new test asserts the
      provenance value in the `Updated` tooltip.

## 4. Documentation and release

- [ ] 4.1 Document the fallback and the two provenances in
      `openchamber-modelselect/README.md`; verify the wording matches the
      tooltip strings.
- [ ] 4.2 Rebuild `service/main.js`, run `bun run check` and `bun run test`;
      verify all four test files pass.
- [ ] 4.3 Add the `CHANGELOG.md` entry naming the new capability and the
      re-approval; verify the version matches `package.json`.

## Workflow follow-up

- Archive the change after review, and sync the `host-opencode-access` spec.
