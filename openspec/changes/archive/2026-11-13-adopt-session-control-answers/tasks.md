# Tasks

## 1. Manifest

- [x] 1.1 Add `answers: true` to `contributes.sessionControl` (the `sessionAnswers` capability is derived from it, never declared under `contributes.capabilities`) and subscribe the service to the `permission-asked` and `question-asked` session events.
- [x] 1.2 Raise `engines.openchamber` to `>=2.7.1` and pin `@openchamber/sdk` `2.7.1`.

## 2. Service

- [x] 2.1 Use `sessions.answerPermission` for requests in a project the service serves: allow once, with a message.
- [x] 2.2 Use `sessions.answerForm` with the values the service holds (project directory, the plugin's pick); never answer a `page` — send it to the session.
- [x] 2.3 Handle 404 (already settled) by logging and moving on, never retrying.
- [x] 2.4 Keep "allow once, never always"; keep `sessions.stop` under plain `sessionControl`.

## 3. Verification

- [x] 3.1 Update approval text in `openchamber-modelselect/README.md`.
- [x] 3.2 Rebuild `service/main.js`, run `bun run check` and `bun run test`.
