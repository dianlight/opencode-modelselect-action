# Select Model Action

Preselect the OpenCode model for a task class and tier before running the
OpenCode action. The central config (`data/model-config.json` in the repo
root) is keyed by task-type only and read live at runtime, so downstream
workflows pick up model updates with no sync and no edits. There are no
default models: if the config is unreachable or the entry is missing, the
step fails hard unless an explicit `fallback-model` is given.

Runs on Node 24 with zero dependencies (`src/index.js`, relative to this
directory).

This directory is the canonical home of the action. The root `action.yml`
is a thin shim with identical inputs/outputs that points at
`github-action/src/index.js`, so existing users of
`dianlight/opencode-modelselect-action@v1` keep working unchanged.

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

The subpath form (`dianlight/opencode-modelselect-action/github-action@v1`)
resolves the same code directly:

```yaml
- name: Select model
  id: resolve
  uses: dianlight/opencode-modelselect-action/github-action@v1
  with:
    task-type: review
    tier: go
```

For the model tables backing the selection, see the
[Model Recommendations by Task Type](../README.md#model-recommendations-by-task-type)
section in the repo README (auto-updated by maintenance).

## How it works

1. Loads the central config: the local file at `config-path` (relative to
   `GITHUB_WORKSPACE`, absolute paths also accepted) wins when present,
   otherwise fetches `config-url` (15s timeout). Fails when neither works.
2. Matches `task-type` case-insensitively against the top-level `task-types`
   keys of the config (see [Task types](#task-types)).
3. Resolves the model for the requested `tier` (`go`, `free`, or `auto` with
   live quota probing; omitted means `auto` when a token is available, else
   `free`). Applies the `max-cost` budget swap when set.
4. Writes the outputs and logs a `::notice::` with the selection. Any
   unresolvable state exits non-zero (`::error::`). Nothing is ever logged
   with the token value.

## Requirements

- `task-type` is always required (see [Task types](#task-types)).
- `tier` defaults to `auto` when a token is available (`opencode-token` input or
  `OPENCODE_API_KEY` env var), otherwise to `free`. Explicit `tier: auto`
  requires a token; other tiers ignore it.
- All inputs are trimmed; `tier` and `auto-preference` are case-insensitive
  (`Go`, `FREE-FIRST`, … all work).

## Inputs

| Input | Required | Description | Default |
|-------|----------|-------------|---------|
| `task-type` | yes | Task class to select the model for. Must match a key of `task-types` in the central config (see [Task types](#task-types)). Matched case-insensitively; the canonical key is echoed in the `task-type` output. | — |
| `tier` | no | Model tier: `go` (paid), `free`, or `auto` (probe live usage, see [Tier `auto`](#tier-auto-live-quota-probing)). Omitted = `auto` with a token (`opencode-token` or `OPENCODE_API_KEY`), else `free`. Anything else fails the step. | `auto` with token, else `free` |
| `opencode-token` | only for `tier: auto` | Token for live usage checks. Falls back to the `OPENCODE_API_KEY` env var. Used for `GET usage-url` (Go quota) and `POST probe-url` / `POST probe-responses-url` (tiny free-model probes). Never logged. | `""` |
| `auto-preference` | no | Probe order for `tier: auto`: `free-first` (try free, fall back to Go) or `go-first` (reverse). Only meaningful with `tier: auto`. | `free-first` |
| `max-wait-seconds` | no | How long `tier: auto` polls the usage endpoints before failing. `0` = fail fast. Non-negative number (string or number). Polls every `poll-interval-seconds`. | `"0"` |
| `poll-interval-seconds` | no | Seconds between usage re-checks for `tier: auto`. Must be a positive number. | `"60"` |
| `usage-url` | no | Go plan usage endpoint queried by `tier: auto`. Override for tests or mirrors. | `https://opencode.ai/zen/go/v1/usage` |
| `probe-url` | no | Zen chat endpoint used by `tier: auto` for the free availability probe (bare model id, `messages: [{role:user, content:ping}]`, `max_tokens: 1`, `stream: false`). Override for tests or mirrors. | `https://opencode.ai/zen/v1/chat/completions` |
| `probe-responses-url` | no | Zen responses endpoint probed in parallel for free models served there (e.g. `muse-spark` `*-free`, per the Zen docs endpoint table; `model` = bare id, `input: ping`, `max_output_tokens: 1`). Empty derives it from `probe-url` by swapping `/chat/completions` for `/responses`. | `""` (derived) |
| `config-url` | no | Remote URL of the central model config (live source of truth). Only fetched when the local file is absent. Empty disables the remote fallback. | `https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json` |
| `config-path` | no | Local path (relative to `GITHUB_WORKSPACE`, absolute also works) preferred over the remote URL when the file exists and parses as JSON. | `data/model-config.json` |
| `fallback-model` | no | Escape hatch used whenever no model can be resolved: unknown task-type, empty go/free entry, both tiers exhausted/unreachable under `tier: auto`, or no ranked model fits `max-cost`. Emits a `::warning::` and appends `+fallback` to `config-source`. Prefer adding the entry to `data/model-config.json` instead. | `""` |
| `max-cost` | no | Budget cap as blended in/out token cost in $/1M (same 75% in / 25% out blend as the maintenance evaluation). When the resolved pick costs more, it is replaced by the best-scoring ranked model within budget (score desc, then cheapest). Needs a `<tier>_ranked` best-to-worst ranking for the task-type in the config — otherwise the step fails with a hint to regenerate via maintenance. When nothing fits, the step fails (or uses `fallback-model` when given); `model-cost` then holds the replacement cost. Skipped for fallback models. Must be a non-negative number. | `""` |

## Outputs

| Output | Description |
|--------|-------------|
| `model` | Resolved model for the requested tier (or the `fallback-model` when used). Pass to the OpenCode step as `model: ${{ steps.resolve.outputs.model }}`. |
| `model-go` | Resolved Go (paid) model for the task-type (empty when unconfigured). |
| `model-free` | Resolved free model for the task-type (empty when unconfigured). |
| `model-cost` | Blended in/out token cost in $/1M of the resolved model, from the config ranking. Empty when unknown (e.g. fallback-model, or entries without ranking costs). |
| `config-source` | Where the config was loaded from: `local`, `remote`, `local+fallback` or `remote+fallback`. |
| `task-type` | Canonical task-type key as found in the config (or the input verbatim when unmatched and a fallback was used). |
| `tier-selected` | Tier actually used: `go` or `free`. Equals `tier` unless `tier` is `auto`, in which case it reports the probed winner. Empty/unset only when the step fails. |

## Task types

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
| `mechanical-engineer` | Mechanical Engineer | Mechanical engineering, calculations, CAD, thermodynamics, materials |
| `web-search` | Web Search | Ricerche approfondite sul web, sintesi multi-fonte |

## Tier `auto` (live quota probing)

Requires `opencode-token` or `OPENCODE_API_KEY`. Probe order follows
`auto-preference` (`free-first` default, or `go-first`):

- Free: `POST probe-url` (chat shape) and `POST probe-responses-url`
  (responses shape) in parallel with the bare model id (the `opencode/`
  engine prefix is stripped: the Zen API answers 401 "not supported" for
  prefixed names even with valid keys). Best answer wins: success =
  available; HTTP 400 carrying the session gate (`MissingSessionID` / "only
  be used in OpenCode") = selectable — the key is accepted and the free
  route exists, and free models serve the downstream OpenCode step even
  while Go quota remains. HTTP 402/429/503/529, 403, or 404 =
  exhausted/unavailable. HTTP 401 = the key is rejected here (falls back to
  Go; the step fails as invalid token only when Go rejects it too). Other
  HTTP errors or network failures = transient, so the other tier can win.
- Go: `GET usage-url`. Parses the rolling/weekly/monthly windows
  (`percent`/`usagePercent` ≥ 100, or `status` in limited/exhausted/blocked/
  rate_limited/denied = exhausted). HTTP 403/404/429 = unavailable (no Go
  plan / rate-limited). Other HTTP errors, bad JSON, or unknown payload
  shape = transient. HTTP 401 falls back to free; the step fails as invalid
  token only when free rejects it too.

The first available-or-selectable tier in preference order wins and is
reported via `tier-selected`, so `free-first` picks free whenever free is
usable even with Go quota left, and `go-first` mirrors it. When neither is
available, the step retries every `poll-interval-seconds` until
`max-wait-seconds` expires, then fails (or uses `fallback-model` when
given). A `::notice::` is logged on each retry with the last
`free[…]/go[…]` reasons.

```yaml
- name: Select model (auto, wait up to 5 min)
  id: resolve
  uses: dianlight/opencode-modelselect-action/github-action@v1
  with:
    task-type: code
    tier: auto
    opencode-token: ${{ secrets.OPENCODE_API_KEY }}
    auto-preference: free-first # or go-first
    max-wait-seconds: "300"
    poll-interval-seconds: "60"
```

## Config resolution

- Local file at `config-path` wins when it exists and is valid JSON. An
  invalid/unreadable local file fails the step (it is never silently
  skipped).
- Otherwise the remote `config-url` is fetched. A non-200 response or
  invalid JSON counts as unreachable.
- The config must contain a top-level `task-types` (or `task_types`) object
  whose values are `{go, free}` string entries. Violations fail the step.
- `config-source` tells you which path was taken.

## Budget cap (`max-cost`)

Blended $/1M against the `<tier>_ranked` ranking written by maintenance.
Example: cap Go spend at $1/1M, fall back explicitly when nothing fits:

```yaml
- name: Select model (budget-capped)
  id: resolve
  uses: dianlight/opencode-modelselect-action/github-action@v1
  with:
    task-type: review
    tier: go
    max-cost: "1"
    fallback-model: opencode/big-pickle
```

Over-budget picks log a `::warning::` naming the cheaper replacement and its
cost (`model-cost`). Under-budget picks keep their ranked cost.

## More examples

Fixed tiers with explicit fallback and pinned config:

```yaml
- name: Select model (free tier, hard fallback)
  id: resolve
  uses: dianlight/opencode-modelselect-action/github-action@v1
  with:
    task-type: docs
    tier: free
    fallback-model: opencode/big-pickle

- name: Select model (local checkout wins, custom mirror)
  id: resolve
  uses: dianlight/opencode-modelselect-action/github-action@v1
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
  uses: dianlight/opencode-modelselect-action/github-action@v1
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

## Fail-closed behavior

The step exits non-zero when: `task-type` is empty, `tier` /
`auto-preference` / `max-cost` / `max-wait-seconds` / `poll-interval-seconds`
are malformed, the config is unreachable or invalid, the task-type entry is
missing or not a string map, `tier: auto` has no token or gets HTTP 401,
both tiers stay exhausted past `max-wait-seconds`, or no ranked model fits
`max-cost`. Each case prints a `::error::` explaining the fix (add the
config entry, retry later, raise the budget/wait, or pass `fallback-model`).

## Develop

Run the tests from this directory (`npm test` runs `node --test test/`)
or from the repo root (`npm test` delegates here). Verify with
`node --check src/index.js` after changing the action.
