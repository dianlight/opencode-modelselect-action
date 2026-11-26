# Model Recommendations by Task Type

> Automatically updated by the `opencode-maintenance` workflow from
> `data/model-config.json` and LiveBench. Do not edit by hand.

## Model Recommendations by Task Type

> Automatically updated by `opencode-maintenance` workflow.
> Last updated: **2026-11-26 11:21 UTC**.
> LiveBench data: **356 models scored** (41 v2, 315 v1-only).
> LiveBench v2 snapshot: **2026-11-06**.
> v2 Source: https://livebench.ai/data/20261106/table.csv
> LiveBench v1 fallback snapshot: **2026_06_25**.
> v1 Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.
> Blended cost weights: **75% in / 25% out** ($/1M).
> Costs shown as in/out $/1M (Free = $0).

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `plan` (Plan) | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `issue-triage` (Issue Triage) | Triage, label, categorize, route issues | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/beam-free` (79.6, Free) | 🏆 `opencode-go/longcat-2.5` (86.0, $0.3/$1.2) |
| `review` (Review) | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `ui-design` (UI Design) | UI design, components, layouts, mockups | `opencode/claude-opus-5` (83.3, $5/$25) | `opencode/deepseek-v4.1-flash-free` (79.8, Free) | 🏆 `opencode-go/hy4` (84.0, $0.834/$2.501) |
| `ui-testing` (UI Testing) | Playwright, Cypress, E2E, frontend tests | `opencode/gpt-6.2-astra` (91.9, $8/$40) | `opencode/deepseek-v4.1-flash-free` (80.4, Free) | 🏆 `opencode-go/claude-haiku-5-5` (91.4, $0.1/$0.5) |
| `api-testing` (API Testing) | API testing, integration tests, OpenAPI, Postman | `opencode/gpt-6.2-astra` (91.9, $8/$40) | `opencode/deepseek-v4.1-flash-free` (80.4, Free) | 🏆 `opencode-go/claude-haiku-5-5` (91.4, $0.1/$0.5) |
| `docs` (Docs) | Documentation, READMEs, changelogs, docstrings | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/beam-free` (79.6, Free) | 🏆 `opencode-go/longcat-2.5` (86.0, $0.3/$1.2) |
| `debug` (Debug) | Debugging, reproductions, crash and exception triage | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `refactor` (Refactor) | Refactoring, cleanup, tech-debt reduction | `opencode/gpt-6.2-astra` (91.9, $8/$40) | `opencode/deepseek-v4.1-flash-free` (80.4, Free) | 🏆 `opencode-go/claude-haiku-5-5` (91.4, $0.1/$0.5) |
| `security` (Security) | Security review, vulnerabilities, hardening | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `code` (Code) | Code generation, implementation, features | `opencode/gpt-6.2-astra` (91.9, $8/$40) | `opencode/deepseek-v4.1-flash-free` (80.4, Free) | 🏆 `opencode-go/claude-haiku-5-5` (91.4, $0.1/$0.5) |
| `mechanical-engineer` (Mechanical Engineer) | Mechanical engineering, calculations, CAD, thermodynamics, materials | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `web-search` (Web Search) | Ricerche approfondite sul web, sintesi multi-fonte | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/deepseek-v4.1-flash-free` (89.1, Free) | 🏆 `opencode-go/deepseek-v4.1-flash-free` (89.1, Free) |
| `generic` (Generic) | General Q&A, explanations, analysis, everything else | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/beam-free` (79.6, Free) | 🏆 `opencode-go/longcat-2.5` (86.0, $0.3/$1.2) |
| `small-model` (Small Model) | Lightweight utility tasks: commit messages, session titles/renames, summaries | `opencode/gpt-5` (81.6, $1.07/$8.5) | `opencode/beam-free` (79.6, Free) | 🏆 `opencode-go/longcat-2.5` (86.0, $0.3/$1.2) |


### LiveBench Score Reference

> Token costs ($/1M, blended 75% in / 25% out). Value = Overall ÷ Blended $/1M (higher = better value).
> Value shows `—` when it cannot be computed: Free models cost $0
> (value would be infinite), and paid models with unknown pricing
> (`—` in the cost columns) have no divisor.

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following | In $/1M | Out $/1M | Blended $/1M | Value |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|---------|----------|--------------|-------|
| `beam-free` | Free | 📋 Fallback | Triage, Docs | 56.5 | 58.0 | 76.0 | 5.0 | 79.6 | Free | Free | Free | — |
| `big-pickle` | Free | 📋 Fallback | UITest, APITest | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 | Free | Free | Free | — |
| `claude-haiku-5-5` | Go (Paid) | 📋 Fallback | UITest, APITest | 75.6 | 91.4 | 82.4 | 60.0 | 75.0 | $0.1 | $0.5 | $0.2 | 378.0 |
| `deepseek-v4-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 72.6 | 53.6 | 83.9 | 56.4 | 70.3 | $0.66 | $1.98 | $0.99 | 73.3 |
| `deepseek-v4.1-flash` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 73.3 | 80.4 | 89.1 | 79.8 | — | $0.15 | $0.6 | $0.2625 | 279.2 |
| `deepseek-v4.1-flash-free` | Free | ✅ LiveBench v2 | Plan, Review | 73.3 | 80.4 | 89.1 | 79.8 | — | Free | Free | Free | — |
| `flint-40b-free` | Free | 📋 Fallback | UITest, APITest | 63.0 | 72.0 | 70.0 | 5.0 | 65.0 | Free | Free | Free | — |
| `gemini-4-argon` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 80.5 | 85.7 | 95.1 | 69.2 | — | $2 | $10 | $4 | 20.1 |
| `gemini-decision-1` | Go (Paid) | 📋 Fallback | Plan, Review | 66.0 | 30.0 | 66.0 | 40.0 | 50.0 | $0.1 | $0 | $0.075 | 880.0 |
| `gemini-embedding-2` | Go (Paid) | ❌ Missing | — | — | — | — | — | — | $0.2 | $0 | $0.15 | — |
| `glm-5.3` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.7 | 62.5 | 74.0 | 63.6 | 65.0 | $1.4 | $4.4 | $2.15 | 32.0 |
| `glm-5.3-flash` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 64.7 | 70.9 | 77.6 | 73.7 | — | $0.15 | $0.5 | $0.2375 | 272.4 |
| `gpt-5.6-luna` | Go (Paid) | ✅ LiveBench | Plan, Review | 78.8 | 60.0 | 93.0 | 57.0 | 81.6 | $0.2 | $1.2 | $0.45 | 175.1 |
| `gpt-6-luna` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 63.7 | 70.8 | 81.8 | 76.1 | — | $0.1 | $0.5 | $0.2 | 318.5 |
| `gpt-6-luna-decision` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 63.7 | 70.8 | 81.8 | 76.1 | — | $0.1 | $0 | $0.075 | 849.3 |
| `grok-4.7` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 70.3 | 73.1 | 82.7 | 75.0 | — | $2 | $6 | $3 | 23.4 |
| `hungerg-free` | Go (Paid) | ❌ Missing | — | — | — | — | — | — | Free | Free | Free | — |
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | $0.14 | $0.58 | $0.25 | 216.0 |
| `hy4` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | $0.834 | $2.501 | $1.2508 | 63.3 |
| `hy4-flash-free` | Free | 📋 Fallback | Design, Plan | 52.0 | 52.0 | 58.0 | 60.0 | 58.0 | Free | Free | Free | — |
| `hy4-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | $0.834 | $2.501 | $1.2508 | 63.3 |
| `iceman-contributor-free` | Go (Paid) | 📋 Fallback | Triage, Docs | 19.0 | 30.0 | 25.0 | 5.0 | 35.0 | Free | Free | Free | — |
| `iceman-free` | Free | 📋 Fallback | Triage, Docs | 19.0 | 30.0 | 25.0 | 5.0 | 35.0 | Free | Free | Free | — |
| `jev-1.13-free` | Free | 📋 Fallback | Plan, Review | 67.8 | 30.0 | 67.8 | 5.0 | 50.0 | Free | Free | Free | — |
| `jev-1.14` | Go (Paid) | 📋 Fallback | Plan, Review | 66.2 | 30.0 | 66.2 | 40.0 | 50.0 | $0.042 | $0 | $0.0315 | 2101.6 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 | $0.95 | $4 | $1.7125 | 40.2 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 69.4 | 53.1 | 90.7 | 72.5 | — | $3 | $15 | $6 | 11.6 |
| `kimi-k3.1-pro` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 72.6 | 67.8 | 91.1 | 73.7 | — | $2 | $10 | $4 | 18.1 |
| `longcat-2.5` | Go (Paid) | 📋 Fallback | Triage, Docs | 55.0 | 66.0 | 84.0 | 40.0 | 86.0 | $0.3 | $1.2 | $0.525 | 104.8 |
| `mimo-v2.6-flash` | Go (Paid) | 📋 Fallback | Plan, Review | 64.0 | 75.0 | 84.0 | 40.0 | 76.0 | $0.14 | $0.28 | $0.175 | 365.7 |
| `mimo-v2.6-flash-free` | Free | 📋 Fallback | Plan, Review | 60.0 | 71.0 | 80.0 | 38.0 | 72.0 | Free | Free | Free | — |
| `mimo-v2.6-pro` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 69.9 | 64.5 | 79.6 | 74.3 | — | $0.435 | $0.87 | $0.5437 | 128.6 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench | Plan, Review | 67.5 | 51.7 | 76.7 | 50.2 | 66.9 | $0.3 | $1.2 | $0.525 | 128.6 |
| `minimax-m3.1-flash` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 68.2 | 68.8 | 82.9 | 71.2 | — | $0.15 | $0.6 | $0.2625 | 259.8 |
| `muse-spark-1.2-contributor` | Go (Paid) | 📋 Fallback | Plan, Review | 66.0 | 59.3 | 83.0 | 55.0 | 74.0 | $0.1 | $0.2 | $0.125 | 528.0 |
| `muse-spark-1.3-contributor` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 70.0 | 84.4 | 89.7 | 74.8 | — | $0.1 | $0.2 | $0.125 | 560.0 |
| `nemotron-3.5-lightning-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 36.2 | 58.0 | 5.0 | 72.0 | Free | Free | Free | — |
| `nemotron-3.5-super-vl-free` | Free | 📋 Fallback | Plan, Review | 51.5 | 65.5 | 78.8 | 55.0 | 71.0 | Free | Free | Free | — |
| `qwen3-embedding-8b` | Go (Paid) | ❌ Missing | — | — | — | — | — | — | $0.01 | $0 | $0.0075 | — |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Triage | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 | $0.4 | $1.6 | $0.7 | 94.3 |
| `qwen3.8-flash` | Go (Paid) | 📋 Fallback | Plan, Review | 62.9 | 59.0 | 86.0 | 60.0 | 81.3 | $0.15 | $0.47 | $0.23 | 273.5 |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 64.7 | 60.9 | 88.2 | 76.6 | — | $2 | $6 | $3 | 21.6 |
| `qwen4-max` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 76.6 | 69.8 | 92.2 | 79.1 | — | $1.5 | $4.5 | $2.25 | 34.0 |
| `seaglass-alpha-free` | Free | ❌ Missing | — | — | — | — | — | — | Free | Free | Free | — |
| `step-5-preview` | Go (Paid) | ✅ LiveBench v2 | Plan, Review | 57.9 | 67.6 | 83.8 | 70.8 | — | $1 | $2.7 | $1.425 | 40.6 |
| `text-embedding-3-small` | Go (Paid) | ❌ Missing | — | — | — | — | — | — | $0.02 | $0 | $0.015 | — |
