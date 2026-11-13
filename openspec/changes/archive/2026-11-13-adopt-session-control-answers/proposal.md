# Proposal

## Why

OpenChamber 2.7.0 lets a service answer the agent's permission requests and
forms through `sessions.answerPermission` and `sessions.answerForm`, gated by a
new `sessionControl.answers` flag that adds its own `sessionAnswers` line to the
approval dialog. Today the extension can only read sessions; any flow it starts
that hits a permission prompt or a form stalls until a human clicks through.
Adding the flag lets the service carry a decision back instead of leaving the
turn hanging, which matters for unattended routing work and scheduled tasks.

## What Changes

- Add `answers: true` to `contributes.sessionControl`. The `sessionAnswers`
  capability is derived from that flag and shows in the approval dialog as its
  own line, so it is never declared under `contributes.capabilities` — that
  list only takes `prompt`, `sessions`, `files`, `model` and `shells`.
- Subscribe the service to the `permission-asked` and `question-asked` session
  events with their content, so it learns what the agent asks (this asks for
  the `transcript` grant).
- Answer a permission request once, with a message that says the extension
  allowed it; answer a form with the values the service holds (the project
  directory and the plugin's pick for that session); never answer a `page` —
  it goes to the session instead.
- Handle the 404 that means the request already settled in the app or on
  another device: log and move on, never retry.
- Keep "allow once, never always": a standing rule stays a click in the app,
  and `sessions.stop` remains under the plain `sessionControl` grant.
- Update the approval text in `openchamber-modelselect/README.md`.

## Out of scope

- A standing "always allow" rule: the service never creates one.
- Answering a `page`: a page cannot be answered from a service.
- A pending-request row in the Work Status section
  (`status-section-pending-requests` builds on this change).
- Reading the conversation: the service sees the permission's detail and the
  form's fields, nothing else.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.1`.

## Capabilities

### New Capabilities

- `session-answers`: when the service may answer on the user's behalf, which
  requests it answers, how a declined or already-settled request is handled,
  and what stays a manual click.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest, grants, engines, SDK pin),
  rebuilt `service/main.js`, `panel/main.js` and `background/main.js`.
- `openchamber-modelselect/service/src/main.js`, `service/src/answers.js`,
  tests.
- Requires an extension update that asks the user to approve the new grants;
  existing approvals do not carry over.
- Needs the `@openchamber/sdk` 2.7.1 surface; the bump ships with this change.
