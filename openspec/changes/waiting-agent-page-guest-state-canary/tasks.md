# Tasks

## 1. Waiting-state contract

- [ ] 1.1 Add a sim scenario where the host reports waiting on an agent page and verify Work Status shows it

## 2. Remove sniffing

- [ ] 2.1 Remove the injected page/permission messages and key sniffing covered by the host state in `service/src/answers.js`, and verify the model-pick fields still render
- [ ] 2.2 Verify an unrecognized field name does not break the pending indicator

## 3. Documentation

- [ ] 3.1 Document the waiting-state source in the extension README and verify it does not mark `session-control-answers-flags` outdated
