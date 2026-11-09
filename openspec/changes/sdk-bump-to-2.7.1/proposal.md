# Proposal

## Why

The extension is pinned to `@openchamber/sdk` `2.6.2-canary.20261107.11`, while
the host canary now publishes `2.7.1-canary.20261109.13` and stable `2.7.0`.
The newer SDK carries the surface the proposals below depend on:
`OPENCHAMBER_SERVICE_DATA_DIR`, `sessionControl.answers` with
`sessions.answerPermission`/`sessions.answerForm`, richer `question-asked`
content, and `ready.connection`/`host.onConnection`. None of these types exist in
the pinned package, so a change that uses them cannot even be type-checked
against the real manifest schema, and `release-watch` reports the move but
nothing consumes it.

## What Changes

- Bump `openchamber-modelselect` to `@openchamber/sdk`
  `2.7.1-canary.20261109.13` (or stable `2.7.0` once the canary graduates),
  reinstall, rebuild `service/main.js`, `panel/main.js` and
  `background/main.js`, and run the four test files.
- Update `engines.openchamber` to `>=2.7.0` so the new capability keys are
  accepted by the host.
- Refresh the SDK snapshot in the release-watch state and document the pin and
  the reason for a canary pin in `openchamber-modelselect/README.md`.
- No behavior change on its own; this is the prerequisite for
  `adopt-service-data-dir`, `adopt-session-control-answers` and
  `status-section-pending-requests`.

## Capabilities

### New Capabilities

(none — dependency move only, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `openchamber-modelselect/package.json`, `bun.lock`, rebuilt bundles.
- `openchamber-modelselect/README.md`, `CHANGELOG.md`.
- No manifest or permission change.
- Prerequisite for the proposals that consume the 2.7.0 SDK surface.