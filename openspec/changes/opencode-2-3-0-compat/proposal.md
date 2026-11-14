# Proposal

## Why

OpenChamber main moved to OpenCode 2.3.0 on 2026-11-14. It renames
`session.step.first-token` to `time.firstToken` on the assistant message, ignores
`experimental.mcp.event`, makes plugin tools read their abort signal cooperatively
(a tool that returns instead of rethrowing loses its stopped state), marks a
stopped shell call with `metadata.interrupted`, and always runs subagents in the
background. The plugin hooks `prompt`, reads `event.model`, resolves the Zen/Go
token through OpenCode's auth store, and the extension consumes permission and
question events and `experimental.todo`. The current compat change covers only
2.2.7, so a silent move here breaks tier resolution or host detection without a
failing test.

## What Changes

- Run `node --test plugin/test/` against OpenCode 2.3.0 and the host canary.
- Verify the auth store shape (`auth.json`), provider and tool names, event names
  (`time.firstToken`), permission/question payloads, and `todowrite` /
  `experimental.todo`.
- Make any plugin tool rethrow on abort and keep the stopped output, per 2.3.0.
- Add a CI check that compares the bundled OpenCode version with the compat
  matrix and fails when it moves.
- Update `plugin/README.md` and the compat notes.

## Out of Scope

- No model-routing or tier logic change; only the OpenCode contract.
- No extension manifest change.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `>=2.7.2-canary.20261114`.
- Stable: OpenChamber `>=2.7.2` (first stable with bundled OpenCode 2.3.0).

## Capabilities

### New Capabilities

(none — compatibility verification, `skip_specs: true`.)

### Modified Capabilities

(none)

## Impact

- `plugin/src/v2.js`, `plugin/src/shared/auth.js`, `plugin/test/`,
  `plugin/README.md`.
- CI workflow and compat matrix.
- Supersedes `opencode-2-2-7-compat`.
