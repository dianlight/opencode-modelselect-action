# Proposal

## Why

The current canary `2.7.4-canary.20261120.26` is content-identical to stable
`2.7.3`, which bundles OpenCode `2.3.2`. The compatibility change for `2.3.0`
was archived as superseded, so the plugin and action have no recorded verdict
against the tool and automation changes shipped in `2.3.1` and `2.3.2`.
Unverified parser assumptions around the structured `read` result and Code Mode
tool renames can silently break routing.

## What Changes

- Verify the plugin and action against OpenCode `2.3.1`/`2.3.2`: structured
  `read` tool result, tool renames applied inside Code Mode, default background
  compaction, shell timeout moving a command to the background, the
  `automations` flag replacing experimental schedules, plugin updates from
  Settings, and GPT-6.2 prompt caching.
- Add a sim scenario with pinned `2.3.2` fixtures and record any parser or
  tool-name adjustment needed in `plugin/` and `github-action/`.
- Record the verdict in the compatibility matrix and supersede
  `opencode-2-3-0-compat` explicitly.

## Out of Scope

- SDK surface audit (`sdk-surface-audit-2-7-3` owns that).
- Voice input, speech recognition and microphone capabilities.
- Changing the model selection surfaces.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.7.3-canary.20261117.23`.
- Stable: OpenChamber `>=2.7.3` (ships bundled OpenCode `2.3.2`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none)

## Impact

- `plugin/`, `github-action/src/`, `sim/scenarios/`, compatibility docs.
- Supersedes the archived `opencode-2-3-0-compat`.
