# Tasks

## 1. Service flags

- [ ] 1.1 Replace the single `sessionAnswers` flag with `sessionAnswersPermission`, `sessionAnswersForm` and `sessionAnswersAutoSend` in the store read/write path
- [ ] 1.2 Gate the `permission-asked` / `question-asked` handlers in the service on the new flags, with the autosend sub-switch applied to forms

## 2. Panel switches

- [ ] 2.1 Add the experimental permission switch in its own panel section
- [ ] 2.2 Add the form switch with the autosend sub-switch in the Session control section

## 3. Verification

- [ ] 3.1 Update and extend the session answers tests for the flag defaults
- [ ] 3.2 Rebuild the bundles and run the extension check and tests
- [ ] 3.3 Update the README and CHANGELOG

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result.
