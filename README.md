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
  OpenCode v2 only. See the component README for install (v2/OpenChamber),
  options, host detection, the `modelselect/auto-*` virtual models, the
  `/modelselect` command, token resolution and trial runs.
- **OpenChamber Status View** shows the plugin's per-session pick plus the
  global on/off/auto mode switch in the Work Status panel, and records
  session activity into the host-detection session map the plugin reads.
  See the component README for install, build and test.

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
> Last updated: **2026-10-22 02:11 UTC**.
> LiveBench data: **362 models scored** (49 v2, 313 v1-only).
> LiveBench v2 snapshot: **2026-10-14**.
> v2 Source: https://livebench.ai/data/20261014/table.csv
> LiveBench v1 fallback snapshot: **2026_06_25**.
> v1 Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.
> Blended cost weights: **75% in / 25% out** ($/1M).
> Costs shown as in/out $/1M (Free = $0).

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `plan` (Plan) | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `issue-triage` (Issue Triage) | Triage, label, categorize, route issues | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/mimo-v2.6-flash-free` (72.0, Free) | 🏆 `opencode-go/longcat-2.0` (90.0, $0.3/$1.2) |
| `review` (Review) | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `ui-design` (UI Design) | UI design, components, layouts, mockups | `opencode/claude-fable-5` (84.7, $10/$50) | `opencode/deepseek-v4.1-flash-free` (79.2, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (79.2, Free) |
| `ui-testing` (UI Testing) | Playwright, Cypress, E2E, frontend tests | `opencode/claude-fable-5` (98.3, $10/$50) | `opencode/deepseek-v4.1-flash-free` (90.2, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (90.2, Free) |
| `api-testing` (API Testing) | API testing, integration tests, OpenAPI, Postman | `opencode/claude-fable-5` (98.3, $10/$50) | `opencode/deepseek-v4.1-flash-free` (90.2, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (90.2, Free) |
| `docs` (Docs) | Documentation, READMEs, changelogs, docstrings | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/mimo-v2.6-flash-free` (72.0, Free) | 🏆 `opencode-go/longcat-2.0` (90.0, $0.3/$1.2) |
| `debug` (Debug) | Debugging, reproductions, crash and exception triage | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `refactor` (Refactor) | Refactoring, cleanup, tech-debt reduction | `opencode/claude-fable-5` (98.3, $10/$50) | `opencode/deepseek-v4.1-flash-free` (90.2, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (90.2, Free) |
| `security` (Security) | Security review, vulnerabilities, hardening | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `code` (Code) | Code generation, implementation, features | `opencode/claude-fable-5` (98.3, $10/$50) | `opencode/deepseek-v4.1-flash-free` (90.2, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (90.2, Free) |
| `mechanical-engineer` (Mechanical Engineer) | Mechanical engineering, calculations, CAD, thermodynamics, materials | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `web-search` (Web Search) | Ricerche approfondite sul web, sintesi multi-fonte | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (86.7, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (86.7, Free) |
| `generic` (Generic) | General Q&A, explanations, analysis, everything else | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/mimo-v2.6-flash-free` (72.0, Free) | 🏆 `opencode-go/longcat-2.0` (90.0, $0.3/$1.2) |
| `small-model` (Small Model) | Lightweight utility tasks: commit messages, session titles/renames, summaries | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/mimo-v2.6-flash-free` (72.0, Free) | 🏆 `opencode-go/longcat-2.0` (90.0, $0.3/$1.2) |

### LiveBench Score Reference

> Token costs ($/1M, blended 75% in / 25% out). Value = Overall ÷ Blended $/1M (higher = better value).
> Value shows `—` when it cannot be computed: Free models cost $0
> (value would be infinite), and paid models with unknown pricing
> (`—` in the cost columns) have no divisor.

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following | In $/1M | Out $/1M | Blended $/1M | Value |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|---------|----------|--------------|-------|
| `beam-free` | Free | ✅ LiveBench v2 | UITest, APITest | 55.5 | 83.9 | 80.2 | 67.9 | — | Free | Free | Free | — |
| `big-pickle` | Free | 📋 Fallback | UITest, APITest | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 | Free | Free | Free | — |
| `claude-haiku-5-5` | Go (Paid) | 📋 Fallback | UITest, APITest | 75.6 | 91.4 | 82.4 | 60.0 | 75.0 | $0.1 | $0.5 | $0.2 | 378.0 |
| `deepseek-v4-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.6 | 53.6 | 83.9 | 56.4 | 70.3 | $1.74 | $3.48 | $2.175 | 33.4 |
| `deepseek-v4.1-flash` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 78.0 | 90.2 | 86.7 | 79.2 | — | $0.3 | $1.2 | $0.525 | 148.6 |
| `deepseek-v4.1-flash-free` | Free | ✅ LiveBench v2 | UITest, APITest | 78.0 | 90.2 | 86.7 | 79.2 | — | Free | Free | Free | — |
| `flint-40b-free` | Free | ❌ Missing | — | — | — | — | — | — | Free | Free | Free | — |
| `gemini-4-argon-contributor` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 84.1 | 89.7 | 95.1 | 73.7 | — | $4 | $20 | $8 | 10.5 |
| `glm-5.1` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.6 | 63.1 | 75.6 | 60.3 | 69.5 | $1.4 | $4.4 | $2.15 | 32.8 |
| `glm-5.2` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.4 | 63.0 | 82.1 | 60.7 | 68.2 | $1.4 | $4.4 | $2.15 | 34.1 |
| `glm-5.3` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 60.7 | 82.8 | 85.8 | 77.3 | — | $1.4 | $4.4 | $2.15 | 28.2 |
| `glm-5.3-flash` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 70.6 | 80.6 | 77.6 | 77.2 | — | $0.15 | $0.5 | $0.2375 | 297.3 |
| `glm-5.3-flash-free` | Free | ✅ LiveBench v2 | UITest, APITest | 70.6 | 80.6 | 77.6 | 77.2 | — | Free | Free | Free | — |
| `gpt-5.6-luna` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 66.1 | 73.6 | 85.6 | 76.0 | — | $0.2 | $1.2 | $0.45 | 146.9 |
| `gpt-6-luna` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 69.4 | 84.5 | 81.8 | 82.5 | — | $0.1 | $0.5 | $0.2 | 347.0 |
| `grok-4.6` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 74.9 | 89.1 | 91.2 | 79.8 | — | $2 | $6 | $3 | 25.0 |
| `grok-4.7` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 74.1 | 84.5 | 82.7 | 78.0 | — | $2 | $6 | $3 | 24.7 |
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | $0.14 | $0.58 | $0.25 | 216.0 |
| `hy4-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | $0.834 | $2.501 | $1.2508 | 63.3 |
| `jev-1.13` | Free | 📋 Fallback | Plan, Review | 67.8 | 30.0 | 67.8 | 5.0 | 50.0 | $0.042 | $0 | $0.0315 | 2152.4 |
| `jev-1.13-free` | Free | 📋 Fallback | Plan, Review | 67.8 | 30.0 | 67.8 | 5.0 | 50.0 | Free | Free | Free | — |
| `kimi-k2.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.9 | 59.6 | 77.9 | 58.1 | 69.7 | $0.95 | $4 | $1.7125 | 41.4 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 | $0.95 | $4 | $1.7125 | 40.2 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 63.4 | 59.3 | 90.7 | 77.2 | — | $3 | $15 | $6 | 10.6 |
| `longcat-2.0` | Go (Paid) | 📋 Fallback | Triage, Docs | 60.0 | 70.0 | 89.0 | 5.0 | 90.0 | $0.3 | $1.2 | $0.525 | 114.3 |
| `mimo-v2.5` | Go (Paid) | 📋 Fallback | Triage, Docs | 62.0 | 60.0 | 64.0 | 58.0 | 65.0 | $0.14 | $0.28 | $0.175 | 354.3 |
| `mimo-v2.5-pro` | Go (Paid) | 📋 Fallback | Triage, Docs | 68.0 | 66.0 | 70.0 | 5.0 | 74.0 | $0.435 | $0.87 | $0.5437 | 125.1 |
| `mimo-v2.6-flash` | Go (Paid) | 📋 Fallback | Plan, Review | 64.0 | 75.0 | 84.0 | 40.0 | 76.0 | $0.14 | $0.28 | $0.175 | 365.7 |
| `mimo-v2.6-flash-free` | Free | 📋 Fallback | Plan, Review | 60.0 | 71.0 | 80.0 | 38.0 | 72.0 | Free | Free | Free | — |
| `mimo-v2.6-pro` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 74.9 | 81.5 | 79.6 | 78.5 | — | $0.435 | $0.87 | $0.5437 | 137.8 |
| `minimax-m2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 60.3 | 59.3 | 62.3 | 31.3 | 62.2 | $0.3 | $1.2 | $0.525 | 114.9 |
| `minimax-m2.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 65.0 | 52.0 | 72.4 | 34.0 | 67.4 | $0.3 | $1.2 | $0.525 | 123.8 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 53.7 | 70.9 | 74.5 | 66.2 | — | $0.3 | $1.2 | $0.525 | 102.3 |
| `minimax-m3.1-flash-free` | Free | ✅ LiveBench v2 | UITest, APITest | 73.1 | 83.9 | 82.9 | 74.0 | — | Free | Free | Free | — |
| `muse-spark-1.2-contributor` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 62.4 | 78.2 | 90.0 | 67.1 | — | $0.1 | $0.2 | $0.125 | 499.2 |
| `muse-spark-1.3-contributor` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 74.8 | 90.2 | 89.7 | 74.8 | — | $0.1 | $0.2 | $0.125 | 598.4 |
| `nemotron-3.5-lightning-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 36.2 | 58.0 | 5.0 | 72.0 | Free | Free | Free | — |
| `nemotron-3.5-super-vl-free` | Free | 📋 Fallback | Plan, Review | 51.5 | 65.5 | 78.8 | 55.0 | 71.0 | Free | Free | Free | — |
| `omen-alpha` | Go (Paid) | 📋 Fallback | Plan, Review | 56.0 | 57.9 | 65.0 | 40.0 | 62.0 | — | — | — | — |
| `qwen3.6-plus` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.0 | 56.1 | 77.0 | 52.5 | 67.7 | $0.5 | $3 | $1.125 | 61.3 |
| `qwen3.7-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 74.1 | 55.8 | 82.4 | 58.7 | 76.6 | $2.5 | $7.5 | $3.75 | 19.8 |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Triage | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 | $0.4 | $1.6 | $0.7 | 94.3 |
| `qwen3.8-flash` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 68.8 | 87.4 | 87.4 | 72.8 | — | $0.15 | $0.47 | $0.23 | 299.1 |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 64.2 | 60.3 | 88.2 | 78.6 | — | $2 | $6 | $3 | 21.4 |
| `step-5-preview` | Go (Paid) | ✅ LiveBench v2 | UITest, APITest | 62.0 | 85.6 | 83.8 | 76.9 | — | $1 | $2.7 | $1.425 | 43.5 |
## Sponsor

<a href="https://github.com/sponsors/dianlight"><img src="https://img.shields.io/github/sponsors/dianlight?style=flat-square&logo=githubsponsors&logoColor=%23EA4AAA" alt="Github Sponsor"></a>
<a href="https://www.buymeacoffee.com/ypKZ2I0"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ypKZ2I0" alt="Buy Me a Coffee"/></a>

### Referral

If you're interested in subscribing to an OpenCode Go plan, [click this referral link](https://opencode.ai/go?ref=HKKSCM481M) — you'll get a $5 credit, and $5 will be donated to support this project.

## License

[MIT License](./LICENSE)