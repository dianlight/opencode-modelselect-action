# Tasks

## 1. Action config support

- [ ] 1.1 Confirm `github-action-v2`'s `websearch` input writes a provider object to both generated configs without changing other settings, and verify with `node --test github-action-v2/test/` and the existing `websearch` unit tests.

## 2. Maintenance workflow wiring

- [ ] 2.1 Add the Web Search provider API key as a repository secret and verify the secret exists in the repository settings.
- [ ] 2.2 Replace `websearch: "false"` in the OpenCode step with a conditional that passes the provider object when the secret is set and `false` otherwise, and verify with `mise run lint-yaml`.
- [ ] 2.3 Pass the provider key env var to the OpenCode step and document it in the step comment, and verify the workflow YAML still passes lint.

## 3. Verification

- [ ] 3.1 Add a sim scenario where the v2 action receives a Web Search provider object and assert both generated configs contain it; verify with `npm run sim`.
- [ ] 3.2 Dispatch `opencode-maintenance.yaml` on `main` and verify the Model Maintenance job and overall workflow conclude `success` with no cancelled-input error.
- [ ] 3.3 Confirm a coverage-fix run with the provider secret set performs at least one Web Search call and posts its source-based result to the maintenance issue.
