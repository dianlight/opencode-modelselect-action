# Tasks

## 1. Service

- [ ] 1.1 Serve `/mentions/search` and `/mentions/resolve` from `service/src/main.js`.
- [ ] 1.2 Search returns up to 20 rows: task types, models from the chain preview, and the current pick, filtered by query.
- [ ] 1.3 Resolve returns a short text block the agent reads with the message (task, tier, model, Think, Jev reason).
- [ ] 1.4 Validate row titles/ids against the SDK limits (`MENTION_TITLE_MAX`, `MENTION_ID_MAX`, `MENTION_TEXT_MAX`) and the 2 s search timeout.

## 2. Docs

- [ ] 2.1 Document the new surface in `openchamber-modelselect/README.md`.

## 3. Verification

- [ ] 3.1 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
