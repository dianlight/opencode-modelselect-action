# Tasks

## 1. Manifest

- [ ] 1.1 Add `answers: true` to `contributes.sessionControl` and `sessionAnswers` to `contributes.capabilities`.
- [ ] 1.2 Raise `engines.openchamber` above 2.7.0.

## 2. Service

- [ ] 2.1 Use `sessions.answerPermission` for requests the service triggered.
- [ ] 2.2 Use `sessions.answerForm` for computable forms; never answer a `page`.
- [ ] 2.3 Handle 404 (already settled) by logging and moving on, never retrying.
- [ ] 2.4 Keep "allow once, never always"; keep `sessions.stop` under plain `sessionControl`.

## 3. Verification

- [ ] 3.1 Update approval text in `openchamber-modelselect/README.md`.
- [ ] 3.2 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
