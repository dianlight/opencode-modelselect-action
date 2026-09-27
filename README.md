# Opencode Modelselect

[![GitHub release](https://img.shields.io/github/v/release/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/commits/main)
[![GitHub issues](https://img.shields.io/github/issues-raw/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/pulls)
[![GitHub license](https://img.shields.io/github/license/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/blob/main/LICENSE)

Model routing ecosystem for OpenCode: GitHub Action for CI, live plugin
for sessions, OpenChamber status view, and LiveBench-driven model ranking
from one central config (`data/model-config.json`), so model updates
propagate with no sync and no edits.

## Components

| Component | Path | Deep docs |
|-----------|------|-----------|
| Select Model Action | `github-action/` | [github-action/README.md](./github-action/README.md) |
| Modelselect Plugin | `plugin/` | [plugin/README.md](./plugin/README.md) |
| OpenChamber Status View | `openchamber-modelselect/` | [openchamber-modelselect/README.md](./openchamber-modelselect/README.md) |

- **Select Model Action** preselects the model in CI before running the
  OpenCode step (`task-type` + `tier` → `model` output). The root
  `action.yml` is a thin shim pointing at `github-action/src/index.js`, so
  `uses: dianlight/opencode-modelselect-action@v1` keeps working; the
  subpath `.../github-action@v1` resolves the same code directly. See the
  component README for inputs, outputs, `tier: auto` probing, `max-cost`
  budgets and fail-closed behavior.
- **Modelselect Plugin** routes the model live inside OpenCode sessions,
  inferring the task-type from project signals, prompt text and agent tag.
  See the component README for install (v1/v2/OpenChamber), options, token
  resolution and trial runs.
- **OpenChamber Status View** shows the plugin's per-session pick plus the
  global on/off/auto mode switch in the Work Status panel. See the
  component README for install, build and test.

## Quick start

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: review
    tier: go

- uses: anomalyco/opencode/github@<sha>
  with:
    model: ${{ steps.resolve.outputs.model }}
```

There are no default models: if the config is unreachable or the entry is
missing, the step fails hard unless an explicit `fallback-model` is given.

## Central config and maintenance

`data/model-config.json` is the **actual configuration**, keyed by
task-type only (`task-types.<name>.{go,free}`), consumed by every component
at startup. The maintenance script (`scripts/opencode_maintenance.py`, run
by the `opencode-maintenance` workflow) recomputes the config each run and
commits it directly; task types are defined in `config/task-types.yaml`.
To change a model: run `mise run maintenance` and review the committed
`data/model-config.json` diff — downstream workflows pick it up
automatically at their next run.

## Model Recommendations by Task Type

> Automatically updated by `opencode-maintenance` workflow.
> Last updated: **2026-09-27 05:48 UTC**.
> LiveBench data: **350 models scored**.
> LiveBench snapshot: **2026_06_25**.
> Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.
> Blended cost weights: **75% in / 25% out** ($/1M).
> Costs shown as in/out $/1M (Free = $0).

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `plan` (Plan) | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `issue-triage` (Issue Triage) | Triage, label, categorize, route issues | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/longcat-2.5-preview-free` (86.0, Free) | 🏆 `opencode-go/longcat-2.5-preview-free` (86.0, Free) |
| `review` (Review) | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `ui-design` (UI Design) | UI design, components, layouts, mockups | `opencode/gpt-6-astra` (86.3, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (68.4, Free) | 🏆 `opencode-go/hy4-preview` (84.0, $0.834/$2.501) |
| `ui-testing` (UI Testing) | Playwright, Cypress, E2E, frontend tests | `opencode/claude-opus-5-5` (78.7, $4/$20) | `opencode/mimo-v2.6-flash-free` (71.0, Free) | 🏆 `opencode-go/deepseek-v4.1-flash` (78.4, $0.3/$1.2) |
| `api-testing` (API Testing) | API testing, integration tests, OpenAPI, Postman | `opencode/claude-opus-5-5` (78.7, $4/$20) | `opencode/mimo-v2.6-flash-free` (71.0, Free) | 🏆 `opencode-go/deepseek-v4.1-flash` (78.4, $0.3/$1.2) |
| `docs` (Docs) | Documentation, READMEs, changelogs, docstrings | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/longcat-2.5-preview-free` (86.0, Free) | 🏆 `opencode-go/longcat-2.5-preview-free` (86.0, Free) |
| `debug` (Debug) | Debugging, reproductions, crash and exception triage | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `refactor` (Refactor) | Refactoring, cleanup, tech-debt reduction | `opencode/claude-opus-5-5` (78.7, $4/$20) | `opencode/mimo-v2.6-flash-free` (71.0, Free) | 🏆 `opencode-go/deepseek-v4.1-flash` (78.4, $0.3/$1.2) |
| `security` (Security) | Security review, vulnerabilities, hardening | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `code` (Code) | Code generation, implementation, features | `opencode/claude-opus-5-5` (78.7, $4/$20) | `opencode/mimo-v2.6-flash-free` (71.0, Free) | 🏆 `opencode-go/deepseek-v4.1-flash` (78.4, $0.3/$1.2) |
| `mechanical-engineer` (Mechanical Engineer) | Mechanical engineering, calculations, CAD, thermodynamics, materials | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `web-search` (Web Search) | Ricerche approfondite sul web, sintesi multi-fonte | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `generic` (Generic) | General Q&A, explanations, analysis, everything else | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/longcat-2.5-preview-free` (86.0, Free) | 🏆 `opencode-go/longcat-2.5-preview-free` (86.0, Free) |
| `small-model` (Small Model) | Lightweight utility tasks: commit messages, session titles/renames, summaries | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/longcat-2.5-preview-free` (86.0, Free) | 🏆 `opencode-go/longcat-2.5-preview-free` (86.0, Free) |

### LiveBench Score Reference

> Token costs ($/1M, blended 75% in / 25% out). Value = Overall ÷ Blended $/1M (higher = better value).
> Value shows `—` when it cannot be computed: Free models cost $0
> (value would be infinite), and paid models with unknown pricing
> (`—` in the cost columns) have no divisor.

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following | In $/1M | Out $/1M | Blended $/1M | Value |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|---------|----------|--------------|-------|
| `big-pickle` | Free | 📋 Fallback | UITest, APITest | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 | Free | Free | Free | — |
| `deepseek-flash` | Go (Paid) | 📋 Fallback | Plan, Review | 67.3 | 69.2 | 89.9 | 5.0 | 80.4 | — | — | — | — |
| `deepseek-v4-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 | $0.14 | $0.28 | $0.175 | 377.7 |
| `deepseek-v4-flash-free` | Free | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 | Free | Free | Free | — |
| `deepseek-v4-flash-vision-exp` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.7 | 66.3 | 86.1 | 57.7 | 75.2 | $0.14 | $0.28 | $0.175 | 444.0 |
| `deepseek-v4-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.6 | 53.6 | 83.9 | 56.4 | 70.3 | $1.74 | $3.48 | $2.175 | 33.4 |
| `deepseek-v4.1-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 81.4 | 78.4 | 88.7 | 61.6 | 74.0 | $0.3 | $1.2 | $0.525 | 155.0 |
| `glm-5` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.7 | 62.5 | 74.0 | 63.6 | 65.0 | $1 | $3.2 | $1.55 | 44.3 |
| `glm-5.1` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.6 | 63.1 | 75.6 | 60.3 | 69.5 | $1.4 | $4.4 | $2.15 | 32.8 |
| `glm-5.2` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.4 | 62.9 | 82.1 | 60.7 | 68.2 | $1.4 | $4.4 | $2.15 | 34.1 |
| `glm-5.3` | Go (Paid) | ✅ LiveBench | Plan, Review | 76.6 | 68.1 | 84.4 | 60.2 | 72.3 | $1.4 | $4.4 | $2.15 | 35.6 |
| `glm-5.3-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 71.1 | 65.6 | 78.2 | 60.3 | 64.5 | $0.15 | $0.5 | $0.2375 | 299.4 |
| `gpt-5.6-luna` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.7 | 62.2 | 84.8 | 51.2 | 66.6 | $0.2 | $1.2 | $0.45 | 163.8 |
| `gpt-6-luna` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.2 | 62.3 | 82.7 | 57.5 | 63.7 | $0.1 | $0.5 | $0.2 | 361.0 |
| `grok-4.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.1 | 61.3 | 86.9 | 66.4 | 73.9 | $2 | $6 | $3 | 25.7 |
| `grok-4.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.0 | 64.9 | 89.1 | 67.1 | 74.3 | $2 | $6 | $3 | 26.3 |
| `grok-4.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 78.3 | 63.3 | 87.9 | 72.4 | 74.3 | $2 | $6 | $3 | 26.1 |
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | $0.14 | $0.58 | $0.25 | 216.0 |
| `hy3-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | — | — | — | — |
| `hy4-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | $0.834 | $2.501 | $1.2508 | 63.3 |
| `jev-1.13-free` | Free | 📋 Fallback | Plan, Review | 67.8 | 30.0 | 67.8 | 5.0 | 50.0 | Free | Free | Free | — |
| `kimi-k2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.2 | 60.1 | 76.7 | 55.0 | 65.3 | $0.6 | $3 | $1.2 | 57.7 |
| `kimi-k2.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.9 | 59.6 | 77.9 | 58.1 | 69.7 | $0.95 | $4 | $1.7125 | 41.4 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 | $0.95 | $4 | $1.7125 | 40.2 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 69.9 | 87.0 | 72.6 | 74.9 | $3 | $15 | $6 | 13.2 |
| `ling-3.0-flash-fin-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 48.0 | 48.0 | 5.0 | 50.0 | Free | Free | Free | — |
| `longcat-2.0` | Go (Paid) | 📋 Fallback | Triage, Docs | 60.0 | 70.0 | 89.0 | 5.0 | 90.0 | $0.3 | $1.2 | $0.525 | 114.3 |
| `longcat-2.5-preview-free` | Free | 📋 Fallback | Triage, Docs | 55.0 | 66.0 | 84.0 | 40.0 | 86.0 | Free | Free | Free | — |
| `mimo-v2-omni` | Go (Paid) | 📋 Fallback | Design, Triage | 50.0 | 42.0 | 48.0 | 55.0 | 50.0 | — | — | — | — |
| `mimo-v2-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 58.4 | 45.5 | 65.8 | 43.6 | 57.8 | — | — | — | — |
| `mimo-v2.5` | Go (Paid) | 📋 Fallback | Triage, Docs | 62.0 | 60.0 | 64.0 | 58.0 | 65.0 | $0.14 | $0.28 | $0.175 | 354.3 |
| `mimo-v2.5-free` | Free | 📋 Fallback | Triage, Docs | 58.0 | 56.0 | 60.0 | 54.0 | 62.0 | Free | Free | Free | — |
| `mimo-v2.5-pro` | Go (Paid) | 📋 Fallback | Triage, Docs | 68.0 | 66.0 | 70.0 | 5.0 | 74.0 | $0.435 | $0.87 | $0.5437 | 125.1 |
| `mimo-v2.6-flash` | Go (Paid) | 📋 Fallback | Plan, Review | 64.0 | 75.0 | 84.0 | 40.0 | 76.0 | $0.14 | $0.28 | $0.175 | 365.7 |
| `mimo-v2.6-flash-free` | Free | 📋 Fallback | Plan, Review | 60.0 | 71.0 | 80.0 | 38.0 | 72.0 | Free | Free | Free | — |
| `mimo-v2.6-pro` | Go (Paid) | 📋 Fallback | Plan, Review | 70.0 | 80.0 | 88.0 | 50.0 | 82.0 | $0.435 | $0.87 | $0.5437 | 128.7 |
| `minimax-m2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 60.3 | 59.3 | 62.3 | 31.3 | 62.2 | $0.3 | $1.2 | $0.525 | 114.9 |
| `minimax-m2.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 65.0 | 52.0 | 72.4 | 34.0 | 67.4 | $0.3 | $1.2 | $0.525 | 123.8 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench | Plan, Review | 67.5 | 51.7 | 76.7 | 50.2 | 66.9 | $0.3 | $1.2 | $0.525 | 128.6 |
| `muse-spark-1.2-contributor` | Go (Paid) | ✅ LiveBench | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | $0.1 | $0.2 | $0.125 | 631.2 |
| `muse-spark-1.2-contributor-free` | Free | ✅ LiveBench | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | Free | Free | Free | — |
| `muse-spark-1.3-contributor` | Go (Paid) | ✅ LiveBench | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | $0.1 | $0.2 | $0.125 | 659.2 |
| `muse-spark-1.3-contributor-free` | Free | ✅ LiveBench | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | Free | Free | Free | — |
| `nemotron-3-ultra-free` | Free | ✅ LiveBench | Plan, Review | 68.7 | 51.5 | 75.6 | 47.8 | 74.0 | Free | Free | Free | — |
| `nemotron-3.5-lightning-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 36.2 | 58.0 | 5.0 | 72.0 | Free | Free | Free | — |
| `omen-alpha` | Go (Paid) | 📋 Fallback | Plan, Review | 56.0 | 57.9 | 65.0 | 40.0 | 62.0 | — | — | — | — |
| `qwen3.5-plus` | Go (Paid) | 📋 Fallback | Plan, Review | 58.0 | 52.0 | 62.0 | 42.0 | 60.0 | $0.2 | $1.2 | $0.45 | 128.9 |
| `qwen3.6-plus` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.0 | 56.1 | 77.0 | 52.5 | 67.7 | $0.5 | $3 | $1.125 | 61.3 |
| `qwen3.7-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 74.1 | 55.8 | 82.4 | 58.7 | 76.6 | $2.5 | $7.5 | $3.75 | 19.8 |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Triage | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 | $0.4 | $1.6 | $0.7 | 94.3 |
| `qwen3.8-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.3 | 66.0 | 84.4 | 55.8 | 77.2 | $0.15 | $0.47 | $0.23 | 336.1 |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 67.9 | 87.9 | 58.6 | 77.2 | $2 | $6 | $3 | 26.5 |
| `space-bunny-free` | Free | 📋 Fallback | Plan, Review | 30.0 | 28.0 | 40.0 | 38.0 | 35.0 | Free | Free | Free | — |
## Sponsor

<a href="https://github.com/sponsors/dianlight"><img src="https://img.shields.io/github/sponsors/dianlight?style=flat-square&logo=githubsponsors&logoColor=%23EA4AAA" alt="Github Sponsor"></a>
<a href="https://www.buymeacoffee.com/ypKZ2I0"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ypKZ2I0" alt="Buy Me a Coffee"/></a>

### Referral

If you're interested in subscribing to an OpenCode Go plan, [click this referral link](https://opencode.ai/go?ref=HKKSCM481M) — you'll get a $5 credit, and $5 will be donated to support this project.

## License

[MIT License](./LICENSE)