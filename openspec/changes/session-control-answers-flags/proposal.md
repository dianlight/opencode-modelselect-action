# Proposal

## Why

Commit 87439738 adopted Session Control Answers: the local OpenChamber service
answers the agent's permission requests and computable forms on the user's
behalf, so unattended turns stop stalling. After adoption the behavior did not
work as expected, and the answer path needed an explicit, default-off switch.

The single `sessionAnswers` flag gates the whole answer path. Before the fix is
shipped further, the switch must be split into independent, per-behavior flags.

## What Changes

- Replace the single `sessionAnswers` flag with independent switches:
  - `sessionAnswersPermission` (default off): when enabled, the service answers
    `permission-asked` events with a one-time allow.
  - `sessionAnswersForm` (default off): when enabled, the service answers
    `question-asked` forms with the computable values.
  - `sessionAnswersAutoSend` (default off, sub-option of the form switch): when
    enabled, the service fills defaults into fields it cannot compute and sends
    the full answer; when disabled, it answers with the computable values only.
- The permission switch is marked experimental and lives in its own panel
  section; the form switch with its autosend sub-switch lives in the Session
  control section.
- Answers remain one-shot; standing allow rules stay manual clicks in the app;
  pages are still sent to the session instead of being answered.

## Capabilities

### New Capabilities

- `session-control-answers`: the local service may answer agent-initiated
  permission requests and computable forms on the user's behalf under
  independent opt-in switches.

### Modified Capabilities

- none

## Impact

- `openchamber-modelselect/service/src/main.js` and `service/src/store.js`
- `openchamber-modelselect/panel/src/ext-tab.js`
- Rebuilt bundles: `openchamber-modelselect/service/main.js`,
  `openchamber-modelselect/panel/main.js`
- Tests: `openchamber-modelselect/test/session-answers.test.cjs`
- Docs: `openchamber-modelselect/README.md`, `CHANGELOG.md`

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.1-canary.20261109.13`.
- Stable: OpenChamber `>=2.7.0`.

## Out of Scope

- Standing allow rules and page answering changes.
- Hosts below the OpenChamber engines floor.
- Pending-request surfacing in the Work Status section (owned by
  `status-section-pending-requests`).
- Any change to the `@openchamber/sdk` surface itself.
