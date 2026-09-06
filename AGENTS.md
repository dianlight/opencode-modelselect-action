# AGENTS.md

## Repository purpose

This repo distributes GitHub Actions workflows to multiple downstream repositories. It is **not** an application — it is a workflow distribution hub.

## Active vs deprecated workflows

- **Active (3 files):** `opencode-pr-review.yml`, `opencode-pr-comment.yml`, `opencode-issue-handler.yml`. These implement the 6-process automation pipeline.
- **Deprecated (removed):** `opencode.yml`, `opencode-triage*.yaml`, `opencode-implement.yaml`, `opencode-review.yaml` were deleted; `sync-actions.yml` opens cleanup PRs removing them from downstream repos.
- Do not add new workflow files without also adding them to `.github/sync.yml`.

## Commands

```bash
# Python env (uses mise)
mise install                  # installs python 3.14 + ruff + shellcheck + yamllint, pip installs requirements.txt

# Lint YAML (also runs in CI via opencode-maintenance)
mise run lint-yaml

# Lint Python with ruff (also runs in CI via opencode-maintenance)
mise run lint-python

# Lint shell scripts with shellcheck (also runs in CI via opencode-maintenance)
mise run lint-shell

# Run the maintenance script (fetches models, updates README)
mise run maintenance
# or directly:
python scripts/opencode_maintenance.py
```

## Architecture

### 6-process pipeline

| Process | Workflow | Trigger |
|---------|----------|---------|
| 1 — PR Review | `opencode-pr-review.yml` | `/oc` or `/ocf` on a PR (review) |
| 2 — Bot thread reply | `opencode-pr-comment.yml` | Reply in a bot-owned review thread (no command needed; `/oc`/`/ocf` chooses tier) |
| 3 — User thread takeover | `opencode-pr-comment.yml` | `/oc` or `/ocf` in a human-owned review thread |
| 4 — Issue review | `opencode-issue-handler.yml` | `/oc` or `/ocf` on an issue (review) |
| 5 — Issue implementation | `opencode-issue-handler.yml` | `/oc implement` or `/ocf implement` on an issue |
| 6 — PR task execution | `opencode-pr-comment.yml` | `/oc task` or `/ocf task` on a PR |

`/oc` runs the selected Go (paid) model; `/ocf` runs the free model. Both support the same subcommands (`review`, `implement`, `task`, `retry`).

Authorization gate: all workflows require `author_association` in `OWNER/MEMBER/COLLABORATOR`. Unknown users are silently skipped.

### Shared script

`.github/scripts/auth.sh` parses `/oc` (Go model) and `/ocf` (free model) commands and outputs `IS_OC_COMMAND`, `TIER`, `SUBCOMMAND`, and `TASK_ARGS` via `GITHUB_OUTPUT`.

`.github/scripts/resolve-model.sh` resolves the model for a workflow step at startup from the central model config (`data/model-config.json`). There are **no default models**: if the config is unreachable or the entry is missing, the step fails hard and the workflow stops. Both scripts are synced to downstream repos via `.github/sync.yml`.

### Central model config

`data/model-config.json` is the **actual configuration** consumed by every OpenCode step at startup via `resolve-model.sh` (`model: ${{ steps.resolve.outputs.MODEL }}`) — the audit marks these steps with ⚙️.

The maintenance script computes a **proposed** config each run but never writes over the committed one. If the proposal differs, it saves `data/model-config.proposed.json` (gitignored) and the workflow opens/updates a maintenance issue with the diff. The config changes only through an issue + PR review: check the issue's "Apply the proposed model config update" box and OpenCode opens a PR — merging it is the human gate. The `Commit changes` step excludes `data/model-config.json` from the auto-commit.

To change a model: never edit workflow files. Run `mise run maintenance`, review the proposed config in the resulting issue, and merge a PR that updates `data/model-config.json` — downstream workflows pick it up automatically at their next run.

### Sync system

`.github/sync.yml` defines 4 downstream repos and files to sync. The `sync-actions.yml` workflow uses `BetaHuhn/repo-file-sync-action`. Requires a `GH_PAT` secret.

### Maintenance

`scripts/opencode_maintenance.py` fetches model catalogs (OpenCode Zen/Go + LiveBench), classifies workflows by task type, scores models, updates `README.md` tables, saves results to `data/*.json`, and proposes model config updates (`data/model-config.proposed.json`) — it never applies them: the config changes only via issue + PR review. Each run also fetches Zen model prices from the Zen docs pricing page (`https://opencode.ai/docs/it/zen#pricing`) and stores them per model in `data/zen_models.json` (`pricing` field + `pricing_source`). The usable free list (`free`) is the union of `-free`-suffixed models and any model the pricing page publishes as "Free" — some free models (e.g. `big-pickle`) do not carry the `-free` suffix. Runs on a schedule and on pushes to `opencode-maintenance.yaml`.

## Config files

- `.mise.toml` — tool versions (Python 3.14, yamllint 1.38) and task shortcuts
- `.yamllint` — 180-char line limit for GitHub Actions expressions, 2-space indent, truthy rule relaxed
- `config/task-types.yaml` — task type definitions with signal keywords and priority subscores
- `config/workflow-task-map.yaml` — workflow→task type mapping with job-level overrides
- `config/model-scores.yaml` — static fallback scores for models not on LiveBench
- `ruff.toml` — ruff linter configuration (Python)

## Workflow conventions

- All OpenCode steps pin the action: `anomalyco/opencode/github@<sha>`
- All OpenCode steps resolve their model at startup via `.github/scripts/resolve-model.sh`; the `with: model:` input is always `${{ steps.resolve.outputs.MODEL }}`
- Concurrency groups are keyed by issue/PR number with `cancel-in-progress: false`
- Every process step uses `continue-on-error: true` followed by reaction-on-success/failure steps
- Issue titles are passed via `env:` (not inline substitution) to prevent shell injection
- Multi-line strings in `run: |` blocks must be consistently indented — all content lines must share the same indentation as the first content line; use temp-file patterns (`echo ... > /tmp/file`) instead of inline `--body "..."` for long comment bodies

## Changelog

When updating `CHANGELOG.md`:

- Always fetch remote tags first (`git fetch --tags --force` or `git ls-remote --tags origin`) to detect release tags.
- Changes made after the latest release tag go under `## [Unreleased]`.
- Changes that belong to an already-released version go in the appropriate release paragraph (e.g. `## [0.1.0]`), never in `[Unreleased]`.
- If no release tags exist, all entries go under `## [Unreleased]`.

## Validation

- **Always run `mise run lint-yaml` after editing any YAML file** — the CI lints YAML and a `syntax error: could not find expected ':'` usually means a `|` block line broke out of the correct indent level
- **Always run `mise run lint-python` after editing any Python file** — the CI checks Python with ruff
- **Always run `mise run lint-shell` after editing any shell script** — the CI checks `.github/scripts/auth.sh` and `.github/scripts/resolve-model.sh` with shellcheck
- Verify with `bash -n .github/scripts/auth.sh .github/scripts/resolve-model.sh` after changing the shared scripts

## Renovate

`.github/renovate.json` auto-updates GitHub Actions every Monday with automerge enabled.
