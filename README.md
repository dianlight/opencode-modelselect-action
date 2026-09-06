# Opencode Modelselect
Main repository for my Opencode Modelselect Github Action, shared to multiple repositories and kept in sync

## Documentation

- [**Workflow Flows**](.github/workflows/WORKFLOWS.md) — Deprecated: the
  six-process automation pipeline has been removed; the file is now a
  deprecation pointer.

## Select Model Action

Preselect the OpenCode model for a task class and tier before running the
OpenCode action. The config is keyed by task-type only and read live from this
repo, so downstream workflows pick up model updates with no sync and no edits.

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: pr-review # Plan, Ask, Code, issue-triage, issue-implementation,
      # pr-review, code-implementation, frontend-design, frontend-testing,
      # api-testing, other (matched case-insensitively)
    tier: go # or free (/ocf)

- uses: anomalyco/opencode/github@<sha>
  with:
    model: ${{ steps.resolve.outputs.model }}
```

Optional inputs: `config-url` (override the live config source), `config-path`
(prefer a local checkout copy when present, default `data/model-config.json`),
`fallback-model` (escape hatch when the task-type has no entry — otherwise the
step fails hard). Outputs: `model`, `model-go`, `model-free`,
`config-source`, `task-type`.

## Model Recommendations by Task Type

> Automatically updated by `opencode-maintenance` workflow.
> Last updated: **2026-09-06 06:25 UTC**.
> LiveBench data: **341 models scored**.
> LiveBench snapshot: **2026_06_25**.
> Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `Plan` | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1) | `opencode/nemotron-3-ultra-free` (75.6) | 🏆 `opencode-go/grok-4.6` (89.1) |
| `Ask` | General Q&A, explanations, analysis | `opencode/gpt-5.5-pro` (81.6) | `opencode/nemotron-3-ultra-free` (74.0) | 🏆 `opencode-go/nemotron-3-ultra-free` (74.0) |
| `Code` | Code generation, implementation, refactoring | `opencode/claude-fable-5-1` (74.2) | `opencode/big-pickle` (67.0) | 🏆 `opencode-go/big-pickle` (67.0) |
| `issue-triage` | Triage, label, categorize, route issues | `opencode/gpt-5.5-pro` (81.6) | `opencode/nemotron-3-ultra-free` (74.0) | 🏆 `opencode-go/nemotron-3-ultra-free` (74.0) |
| `issue-implementation` | Implement, fix, resolve issues | `opencode/claude-fable-5-1` (74.2) | `opencode/big-pickle` (67.0) | 🏆 `opencode-go/big-pickle` (67.0) |
| `pr-review` | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1) | `opencode/nemotron-3-ultra-free` (75.6) | 🏆 `opencode-go/grok-4.6` (89.1) |
| `code-implementation` | Generate code, refactor, implement features | `opencode/claude-fable-5-1` (74.2) | `opencode/big-pickle` (67.0) | 🏆 `opencode-go/big-pickle` (67.0) |
| `frontend-design` | UI design, components, layouts, mockups | `opencode/gpt-6-astra` (86.3) | `opencode/mimo-v2.5-free` (54.0) | 🏆 `opencode-go/kimi-k3` (72.6) |
| `frontend-testing` | Playwright, Cypress, E2E, frontend tests | `opencode/claude-fable-5-1` (74.2) | `opencode/big-pickle` (67.0) | 🏆 `opencode-go/big-pickle` (67.0) |
| `api-testing` | API testing, integration tests, OpenAPI, Postman | `opencode/claude-fable-5-1` (74.2) | `opencode/big-pickle` (67.0) | 🏆 `opencode-go/big-pickle` (67.0) |
| `other` | Everything else | `opencode/claude-fable-5-1` (83.8) | `opencode/nemotron-3-ultra-free` (68.7) | 🏆 `opencode-go/kimi-k3` (79.5) |

### LiveBench Score Reference

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|
| `big-pickle` | Free | 📋 Fallback | Code, Impl | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 |
| `deepseek-v4-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 |
| `deepseek-v4-flash-free` | Free | ✅ LiveBench | Plan, Review | 66.1 | 50.3 | 73.1 | 46.9 | 69.4 |
| `deepseek-v4-flash-vision-exp` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.7 | 66.3 | 86.1 | 57.7 | 75.2 |
| `deepseek-v4-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.6 | 53.6 | 83.9 | 56.4 | 70.3 |
| `glm-5` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.7 | 62.5 | 74.0 | 63.6 | 65.0 |
| `glm-5.1` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.6 | 63.1 | 75.6 | 60.3 | 69.5 |
| `glm-5.2` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.4 | 62.9 | 82.1 | 60.7 | 68.2 |
| `glm-5.3` | Go (Paid) | ✅ LiveBench | Plan, Review | 76.6 | 68.1 | 84.4 | 60.2 | 72.3 |
| `glm-5.3-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 71.1 | 65.6 | 78.2 | 60.3 | 64.5 |
| `gpt-5.6-luna` | Go (Paid) | ✅ LiveBench | Plan, Review | 73.7 | 62.2 | 84.8 | 51.2 | 66.6 |
| `grok-4.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.1 | 61.3 | 86.9 | 66.4 | 73.9 |
| `grok-4.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.0 | 64.9 | 89.1 | 67.1 | 74.3 |
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 |
| `hy3-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 |
| `hy4-preview` | Go (Paid) | ❌ Missing | — | — | — | — | — | — |
| `kimi-k2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.2 | 60.1 | 76.7 | 55.0 | 65.3 |
| `kimi-k2.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.9 | 59.6 | 77.9 | 58.1 | 69.7 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 69.9 | 87.0 | 72.6 | 74.9 |
| `ling-3.0-flash-fin-free` | Free | 📋 Fallback | Ask, Triage | 45.0 | 48.0 | 48.0 | 40.0 | 50.0 |
| `longcat-2.0` | Go (Paid) | ❌ Missing | — | — | — | — | — | — |
| `mimo-v2-omni` | Go (Paid) | 📋 Fallback | Design, Ask | 50.0 | 42.0 | 48.0 | 55.0 | 50.0 |
| `mimo-v2-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 58.4 | 45.5 | 65.8 | 43.6 | 57.8 |
| `mimo-v2.5` | Go (Paid) | 📋 Fallback | Ask, Triage | 62.0 | 60.0 | 64.0 | 58.0 | 65.0 |
| `mimo-v2.5-free` | Free | 📋 Fallback | Ask, Triage | 58.0 | 56.0 | 60.0 | 54.0 | 62.0 |
| `mimo-v2.5-pro` | Go (Paid) | 📋 Fallback | Ask, Triage | 68.0 | 66.0 | 70.0 | 55.0 | 74.0 |
| `minimax-m2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 60.3 | 59.3 | 62.3 | 31.3 | 62.2 |
| `minimax-m2.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 65.0 | 52.0 | 72.4 | 34.0 | 67.4 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench | Plan, Review | 67.5 | 51.7 | 76.7 | 50.2 | 66.9 |
| `muse-spark-1.2-contributor` | Go (Paid) | ❌ Missing | — | — | — | — | — | — |
| `muse-spark-1.2-contributor-free` | Free | ❌ Missing | — | — | — | — | — | — |
| `muse-spark-1.3-contributor` | Go (Paid) | ❌ Missing | — | — | — | — | — | — |
| `muse-spark-1.3-contributor-free` | Free | ❌ Missing | — | — | — | — | — | — |
| `nemotron-3-ultra-free` | Free | ✅ LiveBench | Plan, Review | 68.7 | 51.5 | 75.6 | 47.8 | 74.0 |
| `nemotron-3.5-lightning-free` | Free | ❌ Missing | — | — | — | — | — | — |
| `omen-alpha` | Go (Paid) | ❌ Missing | — | — | — | — | — | — |
| `qwen3.5-plus` | Go (Paid) | 📋 Fallback | Plan, Review | 58.0 | 52.0 | 62.0 | 42.0 | 60.0 |
| `qwen3.6-plus` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.0 | 56.1 | 77.0 | 52.5 | 67.7 |
| `qwen3.7-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 74.1 | 55.8 | 82.4 | 58.7 | 76.6 |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Ask | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 |
| `qwen3.8-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.3 | 66.0 | 84.4 | 55.8 | 77.2 |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 67.9 | 87.9 | 58.6 | 77.2 |

## Workflow Model Audit

> Audited: **2026-09-06 06:25 UTC**
> Workflows checked: **4**
> OpenCode steps found: **7**

| Workflow | Job | Step | Task Type | Current Model | Recommended Zen | Recommended Free | Recommended Go | Status |
|----------|-----|------|-----------|---------------|-----------------|------------------|----------------|--------|
| `opencode-issue-handler` | `process-4` | `Run opencode (Process 4 — Issue Review & Refinement)` | `issue-triage` | `opencode-go/qwen3.8-max` (`/ocf`: `opencode/deepseek-v4-flash-free`) ⚙️ | `opencode/gpt-5.5-pro` (81.6 (+6%)) | 🏆 `opencode/nemotron-3-ultra-free` (74.0) | `opencode-go/nemotron-3-ultra-free` (74.0) | ❗ |
| `opencode-issue-handler` | `process-5` | `Run opencode (Process 5 — Issue Work & PR Creation)` | `issue-implementation` | `opencode/big-pickle` (`/ocf`: `opencode/big-pickle`) ⚙️ | `opencode/claude-fable-5-1` (74.2 (+11%)) | 🏆 `opencode/big-pickle` (67.0) | `opencode-go/big-pickle` (67.0) | ✅ |
| `OpenCode Maintenance` | `Handle Checked Tasks` | `Run OpenCode for checked tasks` | `code-implementation` | `opencode/big-pickle` (`/ocf`: `opencode/big-pickle`) ⚙️ | `opencode/claude-fable-5-1` (74.2 (+11%)) | 🏆 `opencode/big-pickle` (67.0) | `opencode-go/big-pickle` (67.0) | ✅ |
| `opencode-pr-comment` | `process-2` | `Run opencode (Process 2 — Bot thread reply)` | `pr-review` | `opencode-go/qwen3.8-max` (`/ocf`: `opencode/deepseek-v4-flash-free`) ⚙️ | `opencode/gpt-5-codex` (96.1 (+9%)) | `opencode/nemotron-3-ultra-free` (75.6) | 🏆 `opencode-go/grok-4.6` (89.1 (+18%)) | ❌ |
| `opencode-pr-comment` | `process-3` | `Run opencode (Process 3 — User-owned thread takeover)` | `pr-review` | `opencode-go/qwen3.8-max` (`/ocf`: `opencode/deepseek-v4-flash-free`) ⚙️ | `opencode/gpt-5-codex` (96.1 (+9%)) | `opencode/nemotron-3-ultra-free` (75.6) | 🏆 `opencode-go/grok-4.6` (89.1 (+18%)) | ❌ |
| `opencode-pr-comment` | `process-6` | `Run opencode (Process 6 — PR Task Execution)` | `code-implementation` | `opencode/big-pickle` (`/ocf`: `opencode/big-pickle`) ⚙️ | `opencode/claude-fable-5-1` (74.2 (+11%)) | 🏆 `opencode/big-pickle` (67.0) | `opencode-go/big-pickle` (67.0) | ✅ |
| `opencode-pr-review` | `review` | `Run opencode (PR code review)` | `pr-review` | `opencode-go/qwen3.8-max` (`/ocf`: `opencode/deepseek-v4-flash-free`) ⚙️ | `opencode/gpt-5-codex` (96.1 (+9%)) | `opencode/nemotron-3-ultra-free` (75.6) | 🏆 `opencode-go/grok-4.6` (89.1 (+18%)) | ❌ |

_Legend: ✅ Optimal · ⚠️ Warn (free, not best) · ❗ Alert (paid when free is preferred) · ❌ Error (wrong model) · 💀 Fatal (model not set). 🏆 marks the preferred model after free-first policy (free within 5% of best Go → prefer free). ⚙️ marks steps preselected at runtime from the central config (`data/model-config.json`) via the select-model action. Recommended Zen shows best Zen model with score difference vs current model (e.g., `model (+15%)`)._