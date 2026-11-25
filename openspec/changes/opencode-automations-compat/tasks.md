# Tasks

## 1. Parity verification

- [x] 1.1 Add a sim scenario pinned to the host-automations profile that replays a `routing-refresh` wake and a wake inside the 30 s window, and verify `npm run sim` passes with no extra routing refresh.
- [x] 1.2 Add a sim scenario covering the switch-toggle immediate refresh and a wake with no open project, and verify `npm run sim` passes with the same outcomes as the retired polling path.

## 2. Contract and opt-out documentation

- [x] 2.1 Confirm the `/schedule` contract cases (both ids, unknown wire version, no open project) are covered by service tests, adding any missing case, and verify `bun run test` in `openchamber-modelselect/` passes.
- [x] 2.2 Update the extension README to state that host automations are the only scheduler and that `"automations": false` leaves no scheduled refresh, and verify the README and manifest agree.

## 3. Validation

- [x] 3.1 Run `bun run check`, `bun run test`, `npm run sim` and `openspec validate --strict`, and verify all pass with no stale bundle.
