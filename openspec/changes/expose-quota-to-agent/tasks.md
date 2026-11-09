# Tasks

## 1. Service

- [ ] 1.1 Expose a `quota.read` agent tool (through Code Mode) returning the same payload as `POST /quota`.
- [ ] 1.2 Gate it behind the existing `quota` role; no new approval.

## 2. Docs

- [ ] 2.1 Document the tool in the README and the extension card.

## 3. Verification

- [ ] 3.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
