# Tasks

## 1. Surface comparison

- [ ] 1.1 Capture the `2.7.3` SDK tarball's `DOCUMENTATION.md`, `GUEST_SERVICES.md` and exported dist names into an audit table, and verify every extension-used surface has a row.
- [ ] 1.2 Map each planned `2.7.3` behavior to a minimum host version and verify the declared `engines.openchamber >=2.7.1` floor either covers it or is raised.

## 2. Tag check

- [ ] 2.1 Add a maintenance check that resolves the declared stable SDK floor to a published release tag and verify it fails on a non-existent tag.
- [ ] 2.2 Add a regression test using a synthetic missing tag and verify `mise run maintenance` still succeeds for the real config.

## 3. Record

- [ ] 3.1 Write the audit result to the generated docs and verify the doc links from `README.md` resolve.
- [ ] 3.2 Mark `sdk-surface-audit-2-7-2` and `sdk-floor-published-tag-check` as superseded in the archive notes and verify no active change points at them.
