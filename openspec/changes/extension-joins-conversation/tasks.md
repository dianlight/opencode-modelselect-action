# Tasks

## 1. Service

- [ ] 1.1 After a routed turn, post a short summary (task, tier, model, Think, Jev reason) to the session via `sessions.send` or `panels.emit`, gated by a new option.
- [ ] 1.2 Keep it off by default; expose the toggle in the Extension tab.
- [ ] 1.3 Handle `stopped`/busy sessions gracefully (log and skip).

## 2. Panel

- [ ] 2.1 Add the toggle to `panel/src/ext-tab.js`.

## 3. Verification

- [ ] 3.1 Rebuild `service/main.js` and `panel/main.js`, run `bun run check` and `bun run test`.
