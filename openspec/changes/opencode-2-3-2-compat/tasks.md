# Tasks

## 1. Fixtures

- [ ] 1.1 Add a `sim/fixtures/opencode-2-3-2` fixture set with structured `read` output and Code Mode tool names, and verify the fixture files are present and referenced by a scenario.

## 2. Verification

- [ ] 2.1 Add `sim/scenarios/plugin/opencode-2-3-2-compat.cjs` covering the eight `2.3.1`/`2.3.2` items and verify `npm run sim` reports it passing.
- [ ] 2.2 Adjust any parser or tool-name assumption found by the scenario and verify the affected plugin/action unit tests pass.

## 3. Record

- [ ] 3.1 Add a `2.3.2` row to the compatibility matrix with per-item verdicts and verify the document renders the new row.
- [ ] 3.2 Note the supersession of `opencode-2-3-0-compat` in the matrix and verify no stale `2.3.0` recommendation remains.
