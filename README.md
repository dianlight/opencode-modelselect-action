# Opencode Modelselect
Main repository for my Opencode Modelselect Github Action, shared to multiple repositories and kept in sync

## Select Model Action

Preselect the OpenCode model for a task class and tier before running the
OpenCode action. The config is keyed by task-type only and read live from this
repo, so downstream workflows pick up model updates with no sync and no edits.

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: review # plan, generic, code, issue-triage, review,
      # ui-design, ui-testing, api-testing, docs, debug, refactor, security
      # (matched case-insensitively)
    tier: go # or free, or auto (probe live usage)

- uses: anomalyco/opencode/github@<sha>
  with:
    model: ${{ steps.resolve.outputs.model }}
```

With `tier: auto` the action checks live quota using the Opencode token
(requires `opencode-token` or the `OPENCODE_API_KEY` env var): it sends a tiny
probe request to the free model and queries `GET /zen/go/v1/usage` for the Go
plan windows. `auto-preference: free-first` (default) picks free when the
probe succeeds and falls back to Go; `go-first` reverses the order. When both
tiers are exhausted the step fails unless `max-wait-seconds` is set, in which
case it polls every `poll-interval-seconds` (default 60) until quota frees up.
The resolved tier is exposed as the `tier-selected` output (`go` or `free`).

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: pr-review
    tier: auto
    opencode-token: ${{ secrets.OPENCODE_API_KEY }}
    max-wait-seconds: "300"
```

Optional inputs: `config-url` (override the live config source), `config-path`
(prefer a local checkout copy when present, default `data/model-config.json`),
`fallback-model` (escape hatch when the task-type has no entry — otherwise the
step fails hard), `max-cost` (budget cap as blended in/out $/1M: an
over-budget pick is replaced by the best-scoring ranked model within budget,
else the step fails), `opencode-token` (required only by `tier: auto`, falls
back to `OPENCODE_API_KEY`), `auto-preference` (`free-first`/`go-first`),
`max-wait-seconds` / `poll-interval-seconds` (quota polling for `tier: auto`),
`usage-url` / `probe-url` (endpoint overrides). Outputs: `model`, `model-go`,
`model-free`, `model-cost` (blended $/1M of the resolved model, empty when unknown),
`config-source`, `task-type`, `tier-selected`.

## Model Recommendations by Task Type

> Automatically updated by `opencode-maintenance` workflow.
> Last updated: **2026-09-06 09:33 UTC**.
> LiveBench data: **341 models scored**.
> LiveBench snapshot: **2026_06_25**.
> Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.
> Blended cost weights: **75% in / 25% out** ($/1M).
> Costs shown as in/out $/1M (Free = $0).

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `Plan` | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `Ask` | General Q&A, explanations, analysis | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/muse-spark-1.3-contributor-free` (78.9, Free) | 🏆 `opencode-go/longcat-2.0` (85.0) |
| `Code` | Code generation, implementation, refactoring | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `issue-triage` | Triage, label, categorize, route issues | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/muse-spark-1.3-contributor-free` (78.9, Free) | 🏆 `opencode-go/longcat-2.0` (85.0) |
| `issue-implementation` | Implement, fix, resolve issues | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `pr-review` | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `code-implementation` | Generate code, refactor, implement features | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `frontend-design` | UI design, components, layouts, mockups | `opencode/gpt-6-astra` (86.3, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (68.4, Free) | 🏆 `opencode-go/hy4-preview` (84.0) |
| `frontend-testing` | Playwright, Cypress, E2E, frontend tests | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `api-testing` | API testing, integration tests, OpenAPI, Postman | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `other` | Everything else | `opencode/claude-fable-5-1` (83.8, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (82.4, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (82.4, Free) |

### LiveBench Score Reference

> Token costs ($/1M, blended 75% in / 25% out). Value = overall score per blended $.

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following | In $/1M | Out $/1M | Blended $/1M | Value |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|---------|----------|--------------|-------|
| `big-pickle` | Free | 📋 Fallback | Code, Impl | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 | Free | Free | Free | — |
| `deepseek-v4-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 | $0.14 | $0.28 | $0.175 | 377.7 |
| `deepseek-v4-flash-free` | Free | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 | Free | Free | Free | — |
| `deepseek-v4-flash-vision-exp` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.7 | 66.3 | 86.1 | 57.7 | 75.2 | $0.14 | $0.28 | $0.175 | 444.0 |
| `deepseek-v4-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.6 | 53.6 | 83.9 | 56.4 | 70.3 | $1.74 | $3.48 | $2.175 | 33.4 |
| `glm-5` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.7 | 62.5 | 74.0 | 63.6 | 65.0 | $1 | $3.2 | $1.55 | 44.3 |
| `glm-5.1` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.6 | 63.1 | 75.6 | 60.3 | 69.5 | $1.4 | $4.4 | $2.15 | 32.8 |
| `glm-5.2` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.4 | 62.9 | 82.1 | 60.7 | 68.2 | $1.4 | $4.4 | $2.15 | 34.1 |
| `glm-5.3` | Go (Paid) | ✅ LiveBench | Plan, Review | 76.6 | 68.1 | 84.4 | 60.2 | 72.3 | $1.4 | $4.4 | $2.15 | 35.6 |
| `glm-5.3-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 71.1 | 65.6 | 78.2 | 60.3 | 64.5 | $0.15 | $0.5 | $0.2375 | 299.4 |
| `gpt-5.6-luna` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.7 | 62.2 | 84.8 | 51.2 | 66.6 | $0.2 | $1.2 | $0.45 | 163.8 |
| `grok-4.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.1 | 61.3 | 86.9 | 66.4 | 73.9 | $2 | $6 | $3 | 25.7 |
| `grok-4.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.0 | 64.9 | 89.1 | 67.1 | 74.3 | $2 | $6 | $3 | 26.3 |
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | — | — | — | — |
| `hy3-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | — | — | — | — |
| `hy4-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | — | — | — | — |
| `kimi-k2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.2 | 60.1 | 76.7 | 55.0 | 65.3 | $0.6 | $3 | $1.2 | 57.7 |
| `kimi-k2.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.9 | 59.6 | 77.9 | 58.1 | 69.7 | $0.95 | $4 | $1.7125 | 41.4 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 | $0.95 | $4 | $1.7125 | 40.2 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 69.9 | 87.0 | 72.6 | 74.9 | $3 | $15 | $6 | 13.2 |
| `ling-3.0-flash-fin-free` | Free | 📋 Fallback | Ask, Triage | 45.0 | 48.0 | 48.0 | 40.0 | 50.0 | Free | Free | Free | — |
| `longcat-2.0` | Go (Paid) | 📋 Fallback | Plan, Ask | 60.0 | 70.0 | 85.0 | 40.0 | 85.0 | — | — | — | — |
| `mimo-v2-omni` | Go (Paid) | 📋 Fallback | Design, Ask | 50.0 | 42.0 | 48.0 | 55.0 | 50.0 | — | — | — | — |
| `mimo-v2-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 58.4 | 45.5 | 65.8 | 43.6 | 57.8 | — | — | — | — |
| `mimo-v2.5` | Go (Paid) | 📋 Fallback | Ask, Triage | 62.0 | 60.0 | 64.0 | 58.0 | 65.0 | — | — | — | — |
| `mimo-v2.5-free` | Free | 📋 Fallback | Ask, Triage | 58.0 | 56.0 | 60.0 | 54.0 | 62.0 | Free | Free | Free | — |
| `mimo-v2.5-pro` | Go (Paid) | 📋 Fallback | Ask, Triage | 68.0 | 66.0 | 70.0 | 55.0 | 74.0 | — | — | — | — |
| `minimax-m2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 60.3 | 59.3 | 62.3 | 31.3 | 62.2 | $0.3 | $1.2 | $0.525 | 114.9 |
| `minimax-m2.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 65.0 | 52.0 | 72.4 | 34.0 | 67.4 | $0.3 | $1.2 | $0.525 | 123.8 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench | Plan, Review | 67.5 | 51.7 | 76.7 | 50.2 | 66.9 | $0.3 | $1.2 | $0.525 | 128.6 |
| `muse-spark-1.2-contributor` | Go (Paid) | 📋 Fallback | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | — | — | — | — |
| `muse-spark-1.2-contributor-free` | Free | 📋 Fallback | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | Free | Free | Free | — |
| `muse-spark-1.3-contributor` | Go (Paid) | 📋 Fallback | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | — | — | — | — |
| `muse-spark-1.3-contributor-free` | Free | 📋 Fallback | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | Free | Free | Free | — |
| `nemotron-3-ultra-free` | Free | ✅ LiveBench | Plan, Review | 68.7 | 51.5 | 75.6 | 47.8 | 74.0 | Free | Free | Free | — |
| `nemotron-3.5-lightning-free` | Free | 📋 Fallback | Ask, Triage | 45.0 | 36.2 | 58.0 | 5.0 | 72.0 | Free | Free | Free | — |
| `omen-alpha` | Go (Paid) | 📋 Fallback | Plan, Review | 56.0 | 57.9 | 65.0 | 40.0 | 62.0 | — | — | — | — |
| `qwen3.5-plus` | Go (Paid) | 📋 Fallback | Plan, Review | 58.0 | 52.0 | 62.0 | 42.0 | 60.0 | $0.2 | $1.2 | $0.45 | 128.9 |
| `qwen3.6-plus` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.0 | 56.1 | 77.0 | 52.5 | 67.7 | $0.5 | $3 | $1.125 | 61.3 |
| `qwen3.7-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 74.1 | 55.8 | 82.4 | 58.7 | 76.6 | — | — | — | — |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Ask | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 | — | — | — | — |
| `qwen3.8-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.3 | 66.0 | 84.4 | 55.8 | 77.2 | — | — | — | — |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 67.9 | 87.9 | 58.6 | 77.2 | — | — | — | — |

## Workflow Model Audit

> Audited: **2026-09-06 09:33 UTC**
> Workflows checked: **1**
> OpenCode steps found: **1**

| Workflow | Job | Step | Task Type | Current Model | Recommended Zen | Recommended Free | Recommended Go | Status |
|----------|-----|------|-----------|---------------|-----------------|------------------|----------------|--------|
| `OpenCode Maintenance` | `Handle Checked Tasks` | `Run OpenCode for checked tasks` | `code-implementation` | `opencode/big-pickle` (`free`: `opencode/big-pickle`) ⚙️ | `opencode/claude-fable-5-1` (74.2 (+11%), $10/$50) | 🏆 `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) | ⚠️ |

_Legend: ✅ Optimal · ⚠️ Warn (free, not best) · ❗ Alert (paid when free is preferred) · ❌ Error (wrong model) · 💀 Fatal (model not set). 🏆 marks the preferred model after free-first policy (free within 5% of best Go → prefer free). ⚙️ marks steps preselected at runtime from the central config (`data/model-config.json`) via the select-model action. Recommended Zen shows best Zen model with score difference vs current model (e.g., `model (+15%)`)._