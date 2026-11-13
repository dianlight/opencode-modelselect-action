# Design

## Context

See `proposal.md` — Why and What Changes. Constraints found in the code and in
the SDK contract:

- The service today reads sessions and never writes answers back; every flow
  it starts that hits a permission prompt or a form stalls until a human clicks
  through in the host app.
- The host ships `sessions.answerPermission` and `sessions.answerForm` behind
  the new `sessionControl.answers` flag and a `sessionAnswers` capability, with
  hosts older than the new engines floor refusing the key outright.
- `sessionAnswers` is a derived capability: `contributes.capabilities` takes
  only `prompt`, `sessions`, `files`, `model` and `shells`, and the manifest
  parser refuses anything else. The grant is `contributes.sessionControl.answers`.
- The service learns that a request exists only through the `permission-asked`
  and `question-asked` session events; the request id lives in the event, and
  the form's fields (what a computable answer is made of) come with the
  content.

## Goals / Non-Goals

**Goals:**

- Answer permission requests in the projects the service serves through
  `sessions.answerPermission`, once each, with a message that says who
  allowed it.
- Answer forms the service can compute through `sessions.answerForm`.
- Treat a 404 as "already settled" (in the app or on another device): log and
  move on, never retry.
- Keep per-request decisions only; never mint standing allow rules from the
  service.

**Non-Goals:**

- Standing rules ("allow always") stay manual clicks in the app.
- Pages are never answered from a service; they go to the session instead.
- Nothing outside the project the service was asked about is answered.

## Decisions

**D1 — The service answers in the projects it serves.** A request is answered
when its project is one the extension was asked about (the section polled it,
or the panel named it). Anything else is left alone: the extension speaks for
the project the user is working in, not for every session on the machine.
Alternative rejected: answering every session the host reports — the grant
covers any session, but the extension's own reach does not.

**D2 — The events carry the content.** The service subscribes to
`permission-asked` and `question-asked` with `content: true`, which asks for
the `transcript` grant. Without the content there is no permission detail to
judge and no form fields to fill, so the grant is what the answer path costs.
Alternative rejected: identifiers only, which leaves the decision blind.

**D3 — `answerForm` is computed-fields only.** The service fills the fields it
can derive from what it holds: the session's project directory, and the
plugin's pick for that session (model, task type, tier). A field the service
cannot compute keeps its default, and a field whose `when` conditions do not
hold is not filled at all. Alternatives rejected: answering every field (a
guess written into the user's session) and answering nothing (the stall the
change exists to remove).

**D4 — A `page` goes to the session.** A page cannot be answered from a
service; `sessions.send` closes it, as when the user writes in the chat.
Alternative rejected: leaving it open, which keeps the turn hanging.

**D5 — 404 is terminal.** The request already settled in the app or on another
device; the service logs and continues rather than retrying.

**D6 — Decisions are per-request.** Each answer carries one decision; the
service never converts one into a standing rule, preserving the
"allow once, never always" posture.

**D7 — `sessions.stop` stays under plain `sessionControl`.** The answers flag
extends prompting only; stopping a session is a separate grant.

## Risks / Trade-offs

- **Hosts below the engines floor refuse the key** → the manifest declares
  `engines.openchamber: ">=2.7.1"`, the first release with the answers grant;
  older hosts never see the answer code paths.
- **Users must re-approve the grants** → existing approvals do not carry over;
  the update re-asks once, for the session control, session answers and
  transcript lines.
- **A wrong allow is the user's risk** → an answer covers one request only,
  the agent is told who allowed it, and a standing rule stays a click.

## Migration Plan

1. Ship the manifest change and the rebuilt bundles together; without the
   grants the service keeps its current read-only behavior.
2. Raise the engines floor with the host release carrying the flag.
3. Rollback: drop `sessionControl.answers` and the event subscription; the
   service stays read-only and the un-answered flows stall exactly as before.
