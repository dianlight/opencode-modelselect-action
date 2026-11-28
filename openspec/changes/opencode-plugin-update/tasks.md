# Tasks

## 1. Version source

- [ ] 1.1 Add a service endpoint that returns the bundled and loaded plugin versions, and verify it returns all three states (matching, mismatching, missing) in the service test.
- [ ] 1.2 Expose the version state through `panel/src/api.js`, and verify the panel-frame test observes it without direct file I/O.

## 2. Models tab notice

- [ ] 2.1 Render a non-blocking version badge in `panel/src/models-tab.js` with both versions and an update pointer, and verify the mismatch does not hide model rows.
- [ ] 2.2 Document the manual update path in the extension README and verify the wording matches OpenCode `2.3.1` Settings behavior.
- [ ] 2.3 Document how an auto-updated plugin is detected by the parity check and verify the wording matches OpenCode `2.4.0` behavior.
