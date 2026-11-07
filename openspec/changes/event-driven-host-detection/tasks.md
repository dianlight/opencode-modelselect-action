# Tasks

## 1. Shared contract

- [ ] 1.1 Add `core/host-evidence.js` (read v1/v2, write v2, TTL, id validation)
      with Node tests; verify `mise run build-core` copies it into both vendors
      and `mise run build-core-check` passes.
- [ ] 1.2 Point `plugin/src/shared/host.js` at the shared reader, keeping the
      v1 branch; verify tests cover v1, v2, unknown version, and expired
      heartbeat.

## 2. Service writer

- [ ] 2.1 Rewrite `touchSessionMap()` as a heartbeat write with real ids from
      `/api/session` when available and status files otherwise; verify tests
      assert no synthetic key and a 60 s throttle.
- [ ] 2.2 Declare `contributes.sessionEvents: ["session-archived"]` and handle
      `POST /session-events` by removing the entry; verify a delivered event
      removes one id and keeps the heartbeat.
- [ ] 2.3 Add the maintenance prune for ids OpenCode no longer lists; verify a
      fixture with two gone ids leaves one session and a fresh heartbeat.

## 3. Status line and docs

- [ ] 3.1 Update the `/modelselect` host line wording for the heartbeat
      evidence; verify `plugin/README.md` (Host detection) matches the code.
- [ ] 3.2 Rewrite "Session map (host detection)" in
      `openchamber-modelselect/README.md` (v2 shape, 10 min, archive removal,
      mobile note); verify the internal links and constants match the source.
- [ ] 3.3 Rebuild `service/main.js`, run `bun run check` and `bun run test`;
      verify all four test files pass, plus `npm test` at the root for the plugin.

## Workflow follow-up

- Archive the change after review, and sync the `host-detection` spec.
