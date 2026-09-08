## [Unreleased]

## [0.3.0]
### Fixed
- `tier: auto` now honors `auto-preference`: the free probe strips the
  `opencode/` engine prefix before calling Zen (prefixed names answer 401
  "not supported" even for valid keys) and probes the chat and responses
  endpoints in parallel (new `probe-responses-url` input, derived from
  `probe-url` by default) since free models live on either per the Zen docs
  endpoint table. A 400 session gate (`MissingSessionID` / "only be used in
  OpenCode") counts as selectable — the key is accepted and free serves the
  downstream OpenCode step — so `free-first` picks free even while Go quota
  remains. A 401 from one tier falls back to the other; the step fails as
  invalid token only when both tiers reject auth
### Removed
- No-op file-sync job, keep deprecated-workflow cleanup
### Changed
- `tier` input is now dynamic when omitted (was `go`): `auto` when a token
  (`opencode-token` or `OPENCODE_API_KEY`) is available, else `free`
- README Inputs table now lists Description before Default

### Added
- README badges (release, last commit, issues, pull requests, license),
  Sponsor section (copied from `dianlight/srat`, incl. OpenCode Go referral),
  and License section
- README Task types cross-links from the `task-type` input, requirements, and
  How it works; LiveBench Score Reference now explains the Value column
  (Overall ÷ Blended $/1M) and what a missing `—` means (Free $0 cost or
  unknown pricing)

## [0.2.0]
### Removed
- Workflow Model Audit: models are resolved dynamically at runtime from the
  central `data/model-config.json` (committed directly each run), so the
  per-workflow audit table, the issue's suboptimal-configurations section,
  the workflow scanner (`scan_workflows`, `classify_task_type`,
  `classify_model_status`), `data/workflow_scan.json`,
  `config/workflow-task-map.yaml`, and the `signals` keys in
  `config/task-types.yaml` are gone; the maintenance issue now only covers
  model coverage (`config/model-scores.yaml` PRs)

### Added
- Model Audit issue: new "Correct the model coverage issues" checkbox that opens
  a PR scoped to `config/model-scores.yaml` only (removes stale fallback entries
  now on LiveBench, adds scores for models missing data)
- Test coverage: new `test/coverage-extra.test.js` (36 tests, JS at 99% lines
  via `npm run coverage`) and `tests/test_maintenance.py` (52 offline unit
  tests for the maintenance script via `mise run test-python`); CI lints
  `tests/` and runs the Python suite

### Changed
- Model evaluation now uses a blended in/out token-cost selector: each tier
  picks the cheapest blended $/1M cost among models within the free-first
  threshold of the top LiveBench score (weights from `cost_blend` in
  `config/task-types.yaml`, default 75% in / 25% out; unknown costs sort last)
- Rename the project and repository to Opencode Modelselect
  (`dianlight/opencode-modelselect-action`): update `action.yml` name,
  `config-url` default, README, workflows, `package.json`, and User-Agent

### Added
- New select-model GitHub Action (`action.yml` + `src/index.js`, Node 24, zero
  dependencies): preselect the OpenCode model for a `task-type` + `tier`
  (`go`/`free`) step before the OpenCode step, reading the live central
  `data/model-config.json`. Fails hard when the config is unreachable or the
  task-type has no entry (optional `fallback-model` escape hatch). Downstream
  usage: `dianlight/opencode-modelselect-action@<tag>` with `task-type`/`tier` inputs,
  then `model: ${{ steps.resolve.outputs.model }}` in the OpenCode step
- Key the central `data/model-config.json` by task-type only
  (`task-types.<name>.{go,free}`) for all 11 task types, so any downstream
  workflow can preselect a model without workflow/job coupling
- sync-actions now opens (or updates) a `repo-sync/cleanup-deprecated-opencode-workflows`
  PR in each target repo deleting the six deprecated no-op workflows (`opencode.yml`,
  `opencode-triage*.yaml`, `opencode-implement.yaml`, `opencode-review.yaml`)
- Fetch Zen model prices from the Zen docs pricing page during maintenance and
  store them per model in `data/zen_models.json`; treat models published as
  "Free" (e.g. `big-pickle`, which has no `-free` suffix) as usable free models
- Surface in/out token costs ($/1M) in the README recommendation/audit cells
  and the score reference table (new In/Out/Blended/Value columns), include
  `input_cost`/`output_cost`/`blended_cost` in `benchmark_results.json` and
  `audit_results.json`, and report paid models with unknown pricing under
  `coverage_issues.json` `missing_prices` (warn-only)
- New select-model `max-cost` input (blended $/1M budget cap): an over-budget
  pick is replaced by the best-scoring ranked model within budget from the new
  per-task-type `go_ranked`/`free_ranked` lists (best-to-worst with scores and
  costs) in `data/model-config.json`; the step fails when nothing fits unless
  `fallback-model` is given. New `model-cost` output reports the resolved
  model's blended $/1M
- New select-model `tier: auto` mode: probes live quota with `opencode-token`
  (or `OPENCODE_API_KEY`) via a tiny free-model request plus `GET
  /zen/go/v1/usage` for the Go plan windows. `auto-preference`
  (`free-first`/`go-first`) sets the order, `max-wait-seconds` /
  `poll-interval-seconds` poll until quota frees up instead of failing fast.
  New `tier-selected` output reports the tier actually used

### Removed
- Delete the 6-process pipeline workflows (`opencode-pr-review.yml`,
  `opencode-pr-comment.yml`, `opencode-issue-handler.yml`; `opencode-implement.yaml`
  was already gone): drop their entries from `.github/sync.yml` and
  `config/workflow-task-map.yaml`, replace `WORKFLOWS.md` with a deprecation
  pointer, and extend the sync-actions cleanup job to open downstream removal PRs
- Delete `.github/scripts/resolve-model.sh`; model resolution now lives in the
  select-model action. All active workflows use it (`uses: ./` here,
  `dianlight/opencode-modelselect-action@<tag>` downstream) and it is dropped from
  `.github/sync.yml` since model selection needs no file sync
- Drop the per-workflow `fix-suboptimal-configs` checkbox flow from maintenance
  issues: workflows no longer pin models, so `apply-model-config` is the only
  model fix path
- Drop the six deprecated no-op workflow entries from `.github/sync.yml` and delete
  the local stub files; deletion in target repos is now handled by the sync-actions cleanup PR job
- Drop the **alt models** concept and its token-multiplier-driven second
  checkbox from maintenance issues, and remove `token_multipliers` from
  `config/model-scores.yaml`; the maintenance issue now offers only the single
  "Apply the proposed model config update" checkbox
- Remove the last `/oc` / `/ocf` slash-command remains: delete
  `.github/scripts/auth.sh` (command parser, the only file still synced
  downstream — `.github/sync.yml` now carries an empty file list), `RUNBOOK.md`,
  and `.github/workflows/WORKFLOWS.md`; drop the dead conditional-model
  expression parser from `scripts/opencode_maintenance.py` (all steps resolve
  via the select-model action now, audit shows the free model as `free` instead
  of `/ocf`); reword `action.yml`, `README.md`, `AGENTS.md`, and the maintenance
  workflow to `go`/`free` tiers with no slash-command references; extend the
  sync-actions cleanup job to delete `auth.sh` downstream as well

### Fixed
- Restore emoji icons (✅/📋/❌) in the README LiveBench Score Reference
  Source column, replacing the plain `v`/`f`/`x` letters
- Fix `Handle Checked Tasks` failing with `Duplicate header: Authorization` by
  passing `use_github_token: true` to the OpenCode action (the OIDC token
  exchange previously added a second `Authorization` header on top of the one
  persisted by `actions/checkout`); checkout now also fetches full history and
  the job grants `pull-requests: write` so the OpenCode CLI can open the PR it
  wraps task changes in (previously `403 Resource not accessible by integration`)
  after the task itself succeeded
- Fix the opencode-pr-comment workflow failing with
  `fatal: could not read Username for 'https://github.com'` during the OpenCode
  step's `git push` (process-3): with `use_github_token: true` the OpenCode CLI
  skips configuring git credentials, so push-capable jobs must persist the
  `actions/checkout` token and grant `contents: write`. process-3 now persists
  credentials, configures the git identity, and grants `contents: write`;
  process-6 also grants `contents: write` for its push path

Resolves #31


## [0.1.0]
### Added
- Add kimi-k2.7-code model scores to fix coverage issues
- Add job_task_overrides for opencode-pr-comment/process-6 to use code-implementation task type
- Add central model config (`data/model-config.json`) generated by maintenance and
  consumed by workflows at startup via `.github/scripts/resolve-model.sh`, so model
  upgrades no longer require editing workflow files
- Make model resolution fail closed: `.github/scripts/resolve-model.sh` has no default
  models and aborts the workflow when the config is unreachable or the entry is missing
- Treat `data/model-config.json` as real configuration: the maintenance run never
  overwrites it; drift is reported in a maintenance issue and applied only via a
  reviewed PR (checking the issue box makes OpenCode open the PR)

Resolves #12
