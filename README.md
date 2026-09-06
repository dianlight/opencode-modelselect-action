# Opencode Modelselect
Main repository for my Opencode Modelselect Github Action, shared to multiple repositories and kept in sync

## Select Model Action

Preselect the OpenCode model for a task class and tier before running the
OpenCode action. The central config (`data/model-config.json` in this repo)
is keyed by task-type only and read live at runtime, so downstream workflows
pick up model updates with no sync and no edits. There are no default models:
if the config is unreachable or the entry is missing, the step fails hard
unless an explicit `fallback-model` is given.

Runs on Node 24 with zero dependencies (`src/index.js`).

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

### How it works

1. Loads the central config: the local file at `config-path` (relative to
   `GITHUB_WORKSPACE`, absolute paths also accepted) wins when present,
   otherwise fetches `config-url` (15s timeout). Fails when neither works.
2. Matches `task-type` case-insensitively against the top-level `task-types`
   keys of the config.
3. Resolves the model for the requested `tier` (`go`, `free`, or `auto` with
   live quota probing). Applies the `max-cost` budget swap when set.
4. Writes the outputs and logs a `::notice::` with the selection. Any
   unresolvable state exits non-zero (`::error::`). Nothing is ever logged
   with the token value.

### Requirements

- `task-type` is always required.
- `tier: auto` requires a token: pass `opencode-token` or set the
  `OPENCODE_API_KEY` env var. Other tiers ignore the token.
- All inputs are trimmed; `tier` and `auto-preference` are case-insensitive
  (`Go`, `FREE-FIRST`, … all work).

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `task-type` | yes | — | Task class to select the model for. Must match a key of `task-types` in the central config (see Task types below). Matched case-insensitively; the canonical key is echoed in the `task-type` output. |
| `tier` | no | `go` | Model tier: `go` (paid), `free`, or `auto` (probe live usage, see Tier `auto`). Anything else fails the step. |
| `opencode-token` | only for `tier: auto` | `""` | Token for live usage checks. Falls back to the `OPENCODE_API_KEY` env var. Used for `GET usage-url` (Go quota) and `POST probe-url` (tiny free-model probe). Never logged. |
| `auto-preference` | no | `free-first` | Probe order for `tier: auto`: `free-first` (try free, fall back to Go) or `go-first` (reverse). Only meaningful with `tier: auto`. |
| `max-wait-seconds` | no | `"0"` | How long `tier: auto` polls the usage endpoints before failing. `0` = fail fast. Non-negative number (string or number). Polls every `poll-interval-seconds`. |
| `poll-interval-seconds` | no | `"60"` | Seconds between usage re-checks for `tier: auto`. Must be a positive number. |
| `usage-url` | no | `https://opencode.ai/zen/go/v1/usage` | Go plan usage endpoint queried by `tier: auto`. Override for tests or mirrors. |
| `probe-url` | no | `https://opencode.ai/zen/v1/chat/completions` | Zen chat endpoint used by `tier: auto` for the free availability probe (`model` = resolved free model, `messages: [{role:user, content:ping}]`, `max_tokens: 1`, `stream: false`). Override for tests or mirrors. |
| `config-url` | no | `https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json` | Remote URL of the central model config (live source of truth). Only fetched when the local file is absent. Empty disables the remote fallback. |
| `config-path` | no | `data/model-config.json` | Local path (relative to `GITHUB_WORKSPACE`, absolute also works) preferred over the remote URL when the file exists and parses as JSON. |
| `fallback-model` | no | `""` | Escape hatch used whenever no model can be resolved: unknown task-type, empty go/free entry, both tiers exhausted/unreachable under `tier: auto`, or no ranked model fits `max-cost`. Emits a `::warning::` and appends `+fallback` to `config-source`. Prefer adding the entry to `data/model-config.json` instead. |
| `max-cost` | no | `""` | Budget cap as blended in/out token cost in $/1M (same 75% in / 25% out blend as the maintenance evaluation). When the resolved pick costs more, it is replaced by the best-scoring ranked model within budget (score desc, then cheapest). Needs a `<tier>_ranked` best-to-worst ranking for the task-type in the config — otherwise the step fails with a hint to regenerate via maintenance. When nothing fits, the step fails (or uses `fallback-model` when given); `model-cost` then holds the replacement cost. Skipped for fallback models. Must be a non-negative number. |

### Outputs

| Output | Description |
|--------|-------------|
| `model` | Resolved model for the requested tier (or the `fallback-model` when used). Pass to the OpenCode step as `model: ${{ steps.resolve.outputs.model }}`. |
| `model-go` | Resolved Go (paid) model for the task-type (empty when unconfigured). |
| `model-free` | Resolved free model for the task-type (empty when unconfigured). |
| `model-cost` | Blended in/out token cost in $/1M of the resolved model, from the config ranking. Empty when unknown (e.g. fallback-model, or entries without ranking costs). |
| `config-source` | Where the config was loaded from: `local`, `remote`, `local+fallback` or `remote+fallback`. |
| `task-type` | Canonical task-type key as found in the config (or the input verbatim when unmatched and a fallback was used). |
| `tier-selected` | Tier actually used: `go` or `free`. Equals `tier` unless `tier` is `auto`, in which case it reports the probed winner. Empty/unset only when the step fails. |

### Task types

Keys of `task-types` in `data/model-config.json` (defined in
`config/task-types.yaml`, matched case-insensitively):

| Task type | Label | Description |
|-----------|-------|-------------|
| `plan` | Plan | Planning, architecture decisions, task decomposition |
| `generic` | Generic | General Q&A, explanations, analysis, everything else |
| `code` | Code | Code generation, implementation, features |
| `issue-triage` | Issue Triage | Triage, label, categorize, route issues |
| `review` | Review | Review PRs, pull requests, diffs |
| `ui-design` | UI Design | UI design, components, layouts, mockups |
| `ui-testing` | UI Testing | Playwright, Cypress, E2E, frontend tests |
| `api-testing` | API Testing | API testing, integration tests, OpenAPI, Postman |
| `docs` | Docs | Documentation, READMEs, changelogs, docstrings |
| `debug` | Debug | Debugging, reproductions, crash and exception triage |
| `refactor` | Refactor | Refactoring, cleanup, tech-debt reduction |
| `security` | Security | Security review, vulnerabilities, hardening |

### Tier `auto` (live quota probing)

Requires `opencode-token` or `OPENCODE_API_KEY`. Probe order follows
`auto-preference` (`free-first` default, or `go-first`):

- Free: `POST probe-url` with the resolved free model. Success = available.
  HTTP 402/429/503/529, 403, or 404 = exhausted/unavailable. Other HTTP
  errors or network failures = transient (`null`), so the other tier can
  still win. HTTP 401 fails the step immediately (invalid token).
- Go: `GET usage-url`. Parses the rolling/weekly/monthly windows
  (`percent`/`usagePercent` ≥ 100, or `status` in limited/exhausted/blocked/
  rate_limited/denied = exhausted). HTTP 403/404/429 = unavailable (no Go
  plan / rate-limited). Other HTTP errors, bad JSON, or unknown payload
  shape = transient (`null`). HTTP 401 fails the step immediately.

The first available tier in preference order wins and is reported via
`tier-selected`. When neither is available, the step retries every
`poll-interval-seconds` until `max-wait-seconds` expires, then fails (or
uses `fallback-model` when given). A `::notice::` is logged on each retry
with the last `free[…]/go[…]` reasons.

```yaml
- name: Select model (auto, wait up to 5 min)
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: code
    tier: auto
    opencode-token: ${{ secrets.OPENCODE_API_KEY }}
    auto-preference: free-first # or go-first
    max-wait-seconds: "300"
    poll-interval-seconds: "60"
```

### Config resolution

- Local file at `config-path` wins when it exists and is valid JSON. An
  invalid/unreadable local file fails the step (it is never silently
  skipped).
- Otherwise the remote `config-url` is fetched. A non-200 response or
  invalid JSON counts as unreachable.
- The config must contain a top-level `task-types` (or `task_types`) object
  whose values are `{go, free}` string entries. Violations fail the step.
- `config-source` tells you which path was taken.

### Budget cap (`max-cost`)

Blended $/1M against the `<tier>_ranked` ranking written by maintenance.
Example: cap Go spend at $1/1M, fall back explicitly when nothing fits:

```yaml
- name: Select model (budget-capped)
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: review
    tier: go
    max-cost: "1"
    fallback-model: opencode/big-pickle
```

Over-budget picks log a `::warning::` naming the cheaper replacement and its
cost (`model-cost`). Under-budget picks keep their ranked cost.

### More examples

Fixed tiers with explicit fallback and pinned config:

```yaml
- name: Select model (free tier, hard fallback)
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: docs
    tier: free
    fallback-model: opencode/big-pickle

- name: Select model (local checkout wins, custom mirror)
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: security
    tier: go
    config-path: data/model-config.json
    config-url: https://example.com/mirror/model-config.json
```

Consuming every output:

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action@v1
  with:
    task-type: issue-triage
    tier: auto
    opencode-token: ${{ secrets.OPENCODE_API_KEY }}

- name: Show selection
  run: |
    echo "model=${{ steps.resolve.outputs.model }} (tier ${{ steps.resolve.outputs.tier-selected }})"
    echo "go=${{ steps.resolve.outputs.model-go }} free=${{ steps.resolve.outputs.model-free }}"
    echo "cost=${{ steps.resolve.outputs.model-cost }} source=${{ steps.resolve.outputs.config-source }}"
```

### Fail-closed behavior

The step exits non-zero when: `task-type` is empty, `tier` /
`auto-preference` / `max-cost` / `max-wait-seconds` / `poll-interval-seconds`
are malformed, the config is unreachable or invalid, the task-type entry is
missing or not a string map, `tier: auto` has no token or gets HTTP 401,
both tiers stay exhausted past `max-wait-seconds`, or no ranked model fits
`max-cost`. Each case prints a `::error::` explaining the fix (add the
config entry, retry later, raise the budget/wait, or pass `fallback-model`).

## Model Recommendations by Task Type

> Automatically updated by `opencode-maintenance` workflow.
> Last updated: **2026-09-06 12:19 UTC**.
> LiveBench data: **341 models scored**.
> LiveBench snapshot: **2026_06_25**.
> Source: https://livebench.ai/table_2026_06_25.csv
> Free-first threshold: **5%**.
> Blended cost weights: **75% in / 25% out** ($/1M).
> Costs shown as in/out $/1M (Free = $0).

| Task Type | Description | Best Zen | Best Free | Best Go |
|-----------|-------------|----------|-----------|---------|
| `plan` (Plan) | Planning, architecture decisions, task decomposition | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `issue-triage` (Issue Triage) | Triage, label, categorize, route issues | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/muse-spark-1.3-contributor-free` (78.9, Free) | 🏆 `opencode-go/longcat-2.0` (85.0, $0.3/$1.2) |
| `review` (Review) | Review PRs, pull requests, diffs | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `ui-design` (UI Design) | UI design, components, layouts, mockups | `opencode/gpt-6-astra` (86.3, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (68.4, Free) | 🏆 `opencode-go/hy4-preview` (84.0, $0.834/$2.501) |
| `ui-testing` (UI Testing) | Playwright, Cypress, E2E, frontend tests | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `api-testing` (API Testing) | API testing, integration tests, OpenAPI, Postman | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `docs` (Docs) | Documentation, READMEs, changelogs, docstrings | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/muse-spark-1.3-contributor-free` (78.9, Free) | 🏆 `opencode-go/longcat-2.0` (85.0, $0.3/$1.2) |
| `debug` (Debug) | Debugging, reproductions, crash and exception triage | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `refactor` (Refactor) | Refactoring, cleanup, tech-debt reduction | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `security` (Security) | Security review, vulnerabilities, hardening | `opencode/gpt-5-codex` (96.1, $1.07/$8.5) | `opencode/muse-spark-1.3-contributor-free` (90.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (90.9, Free) |
| `code` (Code) | Code generation, implementation, features | `opencode/claude-fable-5-1` (74.2, $10/$50) | `opencode/muse-spark-1.3-contributor-free` (70.9, Free) | 🏆 `opencode-go/muse-spark-1.3-contributor-free` (70.9, Free) |
| `generic` (Generic) | General Q&A, explanations, analysis, everything else | `opencode/gpt-5.5-pro` (81.6, $30/$180) | `opencode/muse-spark-1.3-contributor-free` (78.9, Free) | 🏆 `opencode-go/longcat-2.0` (85.0, $0.3/$1.2) |

### LiveBench Score Reference

> Token costs ($/1M, blended 75% in / 25% out). Value = overall score per blended $.

| Model | Tier | Source | Best For | Overall | Coding | Reasoning | Vision | Instruction Following | In $/1M | Out $/1M | Blended $/1M | Value |
|-------|------|--------|----------|---------|--------|-----------|--------|----------------------|---------|----------|--------------|-------|
| `big-pickle` | Free | 📋 Fallback | UITest, APITest | 61.5 | 67.0 | 61.5 | 8.0 | 60.0 | Free | Free | Free | — |
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
| `hy3` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | $0.14 | $0.58 | $0.25 | 216.0 |
| `hy3-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 54.0 | 55.0 | 60.0 | 8.0 | 58.0 | — | — | — | — |
| `hy4-preview` | Go (Paid) | 📋 Fallback | Plan, Review | 79.2 | 68.9 | 85.0 | 84.0 | 78.0 | $0.834 | $2.501 | $1.2508 | 63.3 |
| `kimi-k2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.2 | 60.1 | 76.7 | 55.0 | 65.3 | $0.6 | $3 | $1.2 | 57.7 |
| `kimi-k2.6` | Go (Paid) | ✅ LiveBench | Plan, Review | 70.9 | 59.6 | 77.9 | 58.1 | 69.7 | $0.95 | $4 | $1.7125 | 41.4 |
| `kimi-k2.7-code` | Go (Paid) | ✅ LiveBench | Plan, Review | 68.8 | 57.0 | 76.9 | 55.7 | 65.9 | $0.95 | $4 | $1.7125 | 40.2 |
| `kimi-k3` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 69.9 | 87.0 | 72.6 | 74.9 | $3 | $15 | $6 | 13.2 |
| `ling-3.0-flash-fin-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 48.0 | 48.0 | 40.0 | 50.0 | Free | Free | Free | — |
| `longcat-2.0` | Go (Paid) | 📋 Fallback | Plan, Triage | 60.0 | 70.0 | 85.0 | 40.0 | 85.0 | $0.3 | $1.2 | $0.525 | 114.3 |
| `mimo-v2-omni` | Go (Paid) | 📋 Fallback | Design, Triage | 50.0 | 42.0 | 48.0 | 55.0 | 50.0 | — | — | — | — |
| `mimo-v2-pro` | Go (Paid) | ✅ LiveBench | Plan, Review | 58.4 | 45.5 | 65.8 | 43.6 | 57.8 | — | — | — | — |
| `mimo-v2.5` | Go (Paid) | 📋 Fallback | Triage, Docs | 62.0 | 60.0 | 64.0 | 58.0 | 65.0 | $0.14 | $0.28 | $0.175 | 354.3 |
| `mimo-v2.5-free` | Free | 📋 Fallback | Triage, Docs | 58.0 | 56.0 | 60.0 | 54.0 | 62.0 | Free | Free | Free | — |
| `mimo-v2.5-pro` | Go (Paid) | 📋 Fallback | Triage, Docs | 68.0 | 66.0 | 70.0 | 55.0 | 74.0 | $0.435 | $0.87 | $0.5437 | 125.1 |
| `minimax-m2.5` | Go (Paid) | ✅ LiveBench | Plan, Review | 60.3 | 59.3 | 62.3 | 31.3 | 62.2 | $0.3 | $1.2 | $0.525 | 114.9 |
| `minimax-m2.7` | Go (Paid) | ✅ LiveBench | Plan, Review | 65.0 | 52.0 | 72.4 | 34.0 | 67.4 | $0.3 | $1.2 | $0.525 | 123.8 |
| `minimax-m3` | Go (Paid) | ✅ LiveBench | Plan, Review | 67.5 | 51.7 | 76.7 | 50.2 | 66.9 | $0.3 | $1.2 | $0.525 | 128.6 |
| `muse-spark-1.2-contributor` | Go (Paid) | ✅ LiveBench | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | $0.1 | $0.2 | $0.125 | 631.2 |
| `muse-spark-1.2-contributor-free` | Free | ✅ LiveBench | Plan, Review | 78.9 | 65.6 | 88.7 | 61.7 | 74.9 | Free | Free | Free | — |
| `muse-spark-1.3-contributor` | Go (Paid) | ✅ LiveBench | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | $0.1 | $0.2 | $0.125 | 659.2 |
| `muse-spark-1.3-contributor-free` | Free | ✅ LiveBench | Plan, Review | 82.4 | 70.9 | 90.9 | 68.4 | 78.9 | Free | Free | Free | — |
| `nemotron-3-ultra-free` | Free | ✅ LiveBench | Plan, Review | 68.7 | 51.5 | 75.6 | 47.8 | 74.0 | Free | Free | Free | — |
| `nemotron-3.5-lightning-free` | Free | 📋 Fallback | Triage, Docs | 45.0 | 36.2 | 58.0 | 5.0 | 72.0 | Free | Free | Free | — |
| `omen-alpha` | Go (Paid) | 📋 Fallback | Plan, Review | 56.0 | 57.9 | 65.0 | 40.0 | 62.0 | $0.2 | $0.66 | $0.315 | 177.8 |
| `qwen3.5-plus` | Go (Paid) | 📋 Fallback | Plan, Review | 58.0 | 52.0 | 62.0 | 42.0 | 60.0 | $0.2 | $1.2 | $0.45 | 128.9 |
| `qwen3.6-plus` | Go (Paid) | ✅ LiveBench | Plan, Review | 69.0 | 56.1 | 77.0 | 52.5 | 67.7 | $0.5 | $3 | $1.125 | 61.3 |
| `qwen3.7-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 74.1 | 55.8 | 82.4 | 58.7 | 76.6 | $2.5 | $7.5 | $3.75 | 19.8 |
| `qwen3.7-plus` | Go (Paid) | 📋 Fallback | Plan, Triage | 66.0 | 62.0 | 72.0 | 62.0 | 72.0 | $0.4 | $1.6 | $0.7 | 94.3 |
| `qwen3.8-flash` | Go (Paid) | ✅ LiveBench | Plan, Review | 77.3 | 66.0 | 84.4 | 55.8 | 77.2 | $0.15 | $0.47 | $0.23 | 336.1 |
| `qwen3.8-max` | Go (Paid) | ✅ LiveBench | Plan, Review | 79.5 | 67.9 | 87.9 | 58.6 | 77.2 | $2 | $6 | $3 | 26.5 |