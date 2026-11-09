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

- Add `answers: true` to `contributes.sessionControl` and `sessionAnswers` to
  `contributes.capabilities` (an `engines.openchamber` floor above 2.7.0 is
  required, since older hosts refuse the key).
- Use `sessions.answerPermission` to answer requests the service itself
  triggered, and `sessions.answerForm` to fill forms whose fields it can
  compute; a `page` is never answered from a service, it sends to the session
  instead.
- Handle the 404 that means the request already settled in the app or on
  another device: log and move on, never retry.
- Keep "allow once, never always": a standing rule stays a click in the app,
  and `sessions.stop` remains under the plain `sessionControl` grant.
- Update the approval text in `openchamber-modelselect/README.md`.

## Capabilities

### New Capabilities

- `session-answers`: when the service may answer on the user's behalf, which
  requests it answers, how a declined or already-settled request is handled,
  and what stays a manual click.

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json` (manifest, capabilities, engines),
  rebuilt `service/main.js`.
- `openchamber-modelselect/service/src/main.js`, tests.
- Requires an extension update that asks the user to approve the new
  capability; existing approvals do not carry over.
- Depends on `sdk-bump-to-2.7.1`.