# Proposal

## Why

The maintenance workflow currently runs its fix agent with `websearch: false`
because Web Search's provider-selection question cannot be answered in a
non-interactive `opencode run`, which failed the whole job. The Secondary Source
Protocol still needs current benchmark data for models missing from LiveBench;
direct HTTP fetches to BenchLM, Artificial Analysis and Hugging Face are the
only fallback, and they did not cover `seaglass-alpha-free`.

## What Changes

- Add a `github-action-v2` path for unattended Web Search: configure a provider
  explicitly so OpenCode never asks the user to pick one, and keep permission
  rules non-interactive.
- Wire the maintenance workflow's OpenCode step to that path with a repository
  secret for the chosen search provider, replacing `websearch: false`.
- Verify with a sim scenario and a dispatched run that a search-backed coverage
  fix completes without an input cancellation.

## Capabilities

### New Capabilities

- `unattended-websearch`: configuring Web Search for non-interactive OpenCode
  runs so provider selection cannot block or fail the run.

### Modified Capabilities

None. Existing provider/model selection behavior is unchanged.

## Impact

- `github-action-v2/src/index.js` and its action manifests: the existing
  `websearch` input already accepts a provider object such as
  `{"provider":"exa"}`; the change defines how that input is applied and tested.
- `.github/workflows/opencode-maintenance.yaml`: replace `websearch: "false"`
  with the configured provider object and add the provider API-key env var.
- Repository secrets: a Web Search provider key (for example `EXA_API_KEY`)
  becomes required for the coverage-fix step.
- Sim harness: new `action-v2` scenario for the configured provider.

Out of scope: provisioning the provider account or key, changing model routing,
changing the plugin, and enabling Web Search in any workflow other than
OpenCode Maintenance.

## Minimum OpenChamber SDK version

- Canary: `@openchamber/sdk` `2.8.1-canary.20261126.32`.
- Stable: OpenChamber `>=2.8.1` (current repo baseline; no new SDK feature).

@242@