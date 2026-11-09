# Tasks

## 1. Service

- [ ] 1.1 Expose an agent tool listing In work sessions for the project (via the host OpenCode connection).
- [ ] 1.2 Expose an agent tool to close a named session.
- [ ] 1.3 Reuse `sessions.stop`/`sessions.status` from the SDK; no new permission beyond `opencode`.
- [ ] 1.4 Keep the tool read-only by default; closing requires an explicit argument.

## 2. Verification

- [ ] 2.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
