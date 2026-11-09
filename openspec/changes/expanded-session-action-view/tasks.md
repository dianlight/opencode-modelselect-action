# Tasks

## 1. Background / service

- [ ] 1.1 Add an expanded view for the `model-pick` action rendering the full pick summary (task, tier, model, Think, Jev, Source, Updated) in a block surface.
- [ ] 1.2 Keep the toast as the fallback for hosts without block surfaces.

## 2. Verification

- [ ] 2.1 Validate the block against the host schema in tests.
- [ ] 2.2 Rebuild `background/main.js` and `service/main.js`, run `bun run check` and `bun run test`.
