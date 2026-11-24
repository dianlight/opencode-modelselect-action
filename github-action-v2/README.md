# OpenCode + modelselect Action (v2)

One GitHub Action that does what the v1 pair does, but keeps model selection
inside OpenCode:

1. installs OpenCode (same install script as `anomalyco/opencode/github`),
2. writes the bundled `plugin/` into the global and project `opencode.json`
   with the options passed to this action,
3. runs `opencode github run` with the OpenCode action's environment.

When `model` is empty the action first runs the v1 select-model rules
(`task-type`, `tier`, `fallback-model`, budget, provider allowlist) and passes
that resolved model to `opencode github run`; this is required because the
CLI validates MODEL before plugins register their virtual provider. The
plugin still receives every routing option and owns runtime failover: when
the chosen model is disabled, unavailable, exhausted or errors for any other
reason it moves to the next chain candidate (different provider first) and
retries. No workflow-level wrapper or chain replay is needed.

## Usage

```yaml
- uses: dianlight/opencode-modelselect-action/github-action-v2@main
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    task-type: review
    tier: auto
    auto-preference: free-first
    fallback-model: opencode/beam-free
    prompt: Review the diff and open a PR.
    use_github_token: true
```

`action-v2.yml` at the repository root is a shim for the same implementation;
the canonical action file is `github-action-v2/action.yml`.

## Inputs

OpenCode action inputs:

| Input | Default | Description |
|-------|---------|-------------|
| `model` | `""` | Model passed to `opencode github run`. Empty resolves one with the v1 select-model rules. An explicit `modelselect/auto-*` anchor works on hosts that register virtual providers early. |
| `agent` | `""` | Primary agent. |
| `share` | `""` | Share the OpenCode session. |
| `prompt` | `""` | Prompt forwarded to OpenCode. |
| `use_github_token` | `false` | Use `GITHUB_TOKEN` instead of OpenCode App token exchange. |
| `mentions` | `""` | Comma-separated trigger phrases. |
| `variant` | `""` | Reasoning-effort variant. |
| `oidc_base_url` | `""` | Custom OIDC exchange base URL. |

Modelselect/plugin inputs (all forwarded as plugin options):

| Input | Default | Description |
|-------|---------|-------------|
| `task-type` | `auto` | Pin a task type, or `auto` for heuristics. |
| `default-task-type` | `generic` | Used when heuristics find no signal. |
| `agent-task-map` | `""` | JSON object mapping agents to task types. |
| `tier` | `auto` | `go`, `free` or `auto`. |
| `auto-preference` | `free-first` | Probe/order preference for `tier: auto`. |
| `fallback-model` | `""` | Used when the plugin resolves no model. |
| `max-cost` | `""` | Blended $/1M budget cap. |
| `available-providers` | `opencode,opencode-go` | Provider slugs the token can reach. |
| `config-url` | `""` | Remote model config URL. |
| `config-v2-url` | `""` | Remote v2 task table URL. |
| `registry-url` | `""` | Remote v2 provider-model registry URL. |
| `catalog-url` | `""` | Remote provider catalog URL. |
| `task-types-url` | `""` | Remote task-type definitions used by Jev. |
| `usage-url` | `""` | Go usage endpoint. |
| `config-refresh-minutes` | `1440` | Config cache lifetime. |
| `verbose` | `false` | Plugin diagnostics. |
| `suggest-only` | `false` | Resolve/log without switching models. |
| `announce` | `switch` | `switch`, `always` or `off`. Use `off` in CI. |
| `jev-model` | `""` | Optional Jev task refinement model. |
| `jev-threshold` | `0.6` | Minimum Jev confidence. |
| `jev-endpoint` | `""` | Jev systemone endpoint. |
| `jev-token` | `""` | Jev token; prefer the exchanged `OPENCODE_API_KEY`. |
| `continuation` | `true` | Inherit the previous task on zero-signal turns. |
| `history-chars` | `2000` | Characters of prior prompt kept for continuation. |
| `openchamber` | `auto` | Host detection force: `auto`, `on`, `off`. |
| `auto-small-model` | `false` | Sync the small model into OpenChamber settings. |
| `small-model-task` | `small-model` | Task type written as the small model. |
| `plugin-package` | `""` | Plugin package/path; empty uses the bundled `plugin/`. |
| `opencode-token` | `""` | OpenCode token. Prefer the exchanged `OPENCODE_API_KEY` env var; never written to config. |

Secrets are never written to `opencode.json`: `opencode-token` is passed only
to the `opencode github run` child process as `OPENCODE_API_KEY`, and
`jev-token` should be supplied through the same environment variable.

## Outputs

| Output | Description |
|--------|-------------|
| `model` | Model passed to `opencode github run` (virtual anchor by default). |
| `plugin-config` | Path of the `opencode.json` the plugin was written to. |
| `plugin-source` | Plugin package/path used in the generated config. |

## Testing

```sh
node --check src/index.js
npm test                 # root suite includes github-action-v2/test/
npm run sim              # includes the action-v2 scenarios
```
