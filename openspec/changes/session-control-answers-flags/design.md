# Design

## Context

See `proposal.md` - Why. The service answers agent-initiated permission and
form requests through the `permission-asked` / `question-asked` session events
it subscribes to, behind the static `sessionControl.answers` manifest grant.

## Goals / Non-Goals

**Goals:**

- Make every answer behavior independently switchable, default off, so the
  feature can be rolled out per behavior.
- Keep answers one-shot and free of standing rules.

**Non-Goals:**

- Standing allow rules.
- Page answering.

## Decisions

**D1** - The answer path is split into independent flags: `sessionAnswersPermission`, `sessionAnswersForm`, and the `sessionAnswersAutoSend` sub-switch of the form flag.

**D2** - The permission flag is marked experimental; the form flag is not.

**D3** - Autosend is a sub-option of the form flag, default off.

**D4** - Pages remain unanswerable and go to the session.

## Risks / Trade-offs

- [Risk] Auto-answering permissions is irreversible per user expectation -> mitigated by the experimental marking and the one-shot contract.
- [Risk] Autosend sending defaults into uncomputable fields -> mitigated by keeping autosend off by default.

## Migration Plan

1. Ship flag split with default off.
2. Roll out per behavior via panel switches.
