## [Unreleased]
### Changed
- Single virtual provider: the dual `opencode/auto` + `opencode-go/auto`
  anchors are replaced by one plugin-owned `modelselect` provider with
  two models — `modelselect/auto-free-first` (pins free-first) and
  `modelselect/auto-go-first` (pins go-first). The provider points at a
  localhost proxy started by the plugin (`plugin/src/proxy.js`), which
  forwards each request to the real Zen/Go base with the resolved pick
  stamped in `x-modelselect-*` headers + body per attempt. Sessions stay
  virtual for life (no `switchModel`, no anchor hops, no leaving virtual
  mode); free-exhaustion arms the forced retry without moving the
  session, and the retry re-resolves with the fresh latch preferring go.
### Fixed
- `ModelProtocolUnsupported` ("Model does not support this protocol")
  still hard-failing virtual turns after the `api` re-sync retry: the
  re-pointed catalog entry does not move an already-pinned session route,
  so the retried dispatch went out on chat/completions again and the turn
  died (reproduced live on host v2.0.23 with a `review` free pick —
  `muse-spark-1.3-contributor-free` is `/responses`-only — while a direct
  session on the same model succeeds). The `retry` hook now fails soft:
  on a virtual-session protocol mismatch it persists the resolved real
  pick via `switchModel` (best-effort; a host without it keeps the plain
  re-synced retry) so the retried attempt resolves its route against the
  real provider's native handling, then retries once. The session leaves
  virtual mode (later turns are hands-off) and the status file records
  the landing (`source` gains `+protocol-failsoft`); still never latched
  as exhaustion, still one shot per session, still skipped in
  `suggestOnly`.
- `ModelProtocolUnsupported` ("Model does not support this protocol")
  hard-failing virtual turns: the virtual entry's catalog `api` could miss
  the pick's protocol — a 24h config cache written before the `endpoints`
  map existed, or a first-turn/title-first race where the re-materialize
  landed after the runner resolved its route — and the error had no
  recovery path. `resolveModel` now falls back to a built-in protocol map
  for known non-chat models when the loaded config carries no entry, and
  the `retry` hook re-syncs the virtual `api` to the pick's protocol and
  retries once on `ModelProtocolUnsupported` (virtual sessions only, never
  latched as exhaustion, one shot per session so it cannot loop).
- Virtual `opencode/auto` sessions failed with `ModelProtocolUnsupported`
  ("Model does not support this protocol") whenever the pick lived on a
  non-chat Zen endpoint — e.g. `muse-spark-1.3-contributor-free`, the top
  free pick for six task types, is `/responses`-only. Dispatch inherited
  the provider default chat/completions route because the virtual entry
  carries no per-model `api`. The maintenance script now parses the docs
  endpoint table into a top-level `endpoints` map in
  `data/model-config.json` (bare model id → `responses`/`messages`/`chat`
  token, with the pricing-style variant fallback), `resolveModel` returns
  the token, and the plugin points the virtual entry's catalog `api` at
  the matching AI SDK package per turn — URL, body shape and stream
  decoder move together (a raw request-URL rewrite in the overlay would
  have broken response decoding). The overlay's `body.model` swap stays
  as the fallback.
### Changed
- The maintenance workflow acts directly on model coverage issues instead of
  waiting for issue checkboxes: when the audit detects stale fallback
  entries, missing scores or vision mismatches it opens a fresh report
  issue (assigned to the repo owner) and in the same run runs OpenCode to
  research the scores and open the "Fix model coverage issues" PR
  (assigned to the repo owner, always superseding any open automation PR).
  The `handle-checkbox-task` job and the `issues`/`issue_comment` triggers
  are gone; the report issue no longer carries checkboxes. Also fixes the
  superseded-PR/assignee loops, which never ran because `gh --jq -r '…'`
  is invalid gh syntax (`--jq` swallowed `-r`), and the issue-number
  output, which received the `gh issue create` URL instead of the number.
  The report+fix chain runs for `schedule`/`workflow_dispatch` only —
  `opencode github run` rejects `push` events, so push runs stay workflow
  self-tests.
- The on/off/auto modes are gone — the virtual `opencode/auto` model is
  the routing switch now: the plugin routes ONLY sessions whose model is
  that ref (announce, status, overlay, free-exhaustion retry); any other
  model is the user's hands-off choice. The global `mode.json` and the
  external `~/.config/openchamber/modelselect.json` `mode` key are no
  longer read. A new per-project `routing-sync.json` (`{"sync":true}`,
  default ON) gates the per-turn `~/.config/openchamber/routing.json`
  refresh via the `/modelselect sync on|off` command; free-exhaustion
  latches + refreshes routing always (while sync is on) but only arms the
  forced retry for virtual sessions. The Work Status view's On/Off/Auto
  tabs became a two-state "Auto-update router" toggle, and the pick grid
  is shown only for auto-ish sessions (empty/unset model = OpenChamber
  auto, or `opencode/auto`); other sessions show the live Model + Agent
  only.
- Mode `auto` no longer depends on OpenChamber: the plugin resolves and
  routes the pick itself in `auto` (identical to `on` — announce, status,
  persistence), instead of syncing `routing.json` and handing off to
  OpenChamber's Jev router. The best-effort `routing.json` sync still
  runs in every mode so an installed OpenChamber follows along; without
  `~/.config/openchamber` it stays a silent no-op. Only `off` skips
  routing now, and free-tier failures flip sessions in `auto` too. The
  Work Status view mirrors this: `auto` shows the full pick grid (only
  `off` hides it) and its mode hint reads `plugin routes (auto)`.
- The virtual model `opencode/auto` is registered in EVERY host
  (previously standalone-only), so the "routes every turn" pick is always
  visible in the model picker; host detection now only feeds the
  `/modelselect` status line.
- The free-tier soft-error latch is PER MODEL
  (`free-quota.json` v2:
  `{version: 2, models: {"<provider/id>": {at, until, kind, …}}}`): an
  exhausted free model only suspends itself — sibling free models keep
  routing free. `resolveModel`, the `routing.json` sync and the Work
  Status countdown (one row per freshly latched model, labelled with the
  suspended model) all follow the entry for the model at hand. Legacy v1
  files still read (a model-less entry remains a global latch over every
  free model).
- The pure decision logic moved into a shared canonical core (`core/`:
  `model-ref`, `free-quota`, `probe`, `budget`, `lookup`, `routing`),
  vendored byte-identical into `github-action/src/shared/core/` and
  `plugin/src/shared/core/` by `scripts/build-core.js` (mise tasks
  `build-core` / `build-core-check`). Each runtime stays self-contained
  (no cross-runtime imports at runtime; `plugin/src/shared/routing.js`
  is now a shim, the Action `require`s its probe/budget helpers, and the
  Work Status bundle imports `core/routing.js` at build time). Drift
  between `core/` and the vendored copies fails CI and the plugin test
  suite (`build-core --check`).

### Added
- Plugin `maxCost` option (alias `max-cost`) is now wired into
  `resolveModel`: an over-budget pick is swapped for the best-scoring
  `<tier>_ranked` model within budget, mirroring the action's `max-cost`
  input; when nothing fits the turn uses `fallbackModel` or keeps the
  current model with a logged error. Invalid values (negative,
  non-numeric) fail option normalization.

### Fixed
- Plugin `historyChars: 0` now keeps no history instead of the full
  prompt (`truncate` treated `max <= 0` as "no limit").
- A Jev answer without a `confidence` number no longer bypasses
  `jevThreshold`: it fails open to the heuristic (`kept:lowconf`).
- A failed model-config cache write (read-only dir, full disk) no longer
  discards a successfully fetched remote config.

## [0.4.0]
### Added
- External modelselect config (`~/.config/openchamber/modelselect.json`,
  user-editable): `{ "mode", "autoSmallModel", "autoWalkthroughModel",
  "smallModelTask" ("small-model"), "walkthroughModelTask" ("review") }`.
  The default mode is now `auto` (was `on`): a missing/invalid
  per-project `mode.json` falls back to the external `mode`, else
  `auto`. When `autoSmallModel` is on, the routing sync writes the
  resolved small-task model into OpenChamber's `settings.json` +
  `preferences.json` as `smallModelOverride` (with
  `smallModelUseDefault: false`); when `autoWalkthroughModel` is on it
  writes the resolved walkthrough-task model as
  `walkthroughModelOverride` (Settings → Sessions → Changes
  Walkthrough Model — the per-panel Walkthrough model picker defaults
  to the small model). Both follow the same go/free preference and
  active free-tier latch window as the routing categories, write only on
  diff, and stay silent on failure. The Work Status extension declares the
  three new paths (`modelselect.json`, `settings.json`,
  `preferences.json`) in its `filesystem` allowlist
- Virtual model `opencode/auto` (standalone hosts only): an `auto`
  entry appended to the real `opencode` provider's inventory (existing
  models preserved, never duplicated) through `ctx.provider.transform`
  when the host resolves standalone; selecting it routes every turn like
  mode `on` but never calls `switchModel`, so the session stays virtual
  and keeps re-routing — `mode.json` is bypassed, and free-tier
  exhaustion only arms the retry (re-pointing the retry event at the
  `go` model in place) instead of flipping the session. Title/compaction/
  generate requests follow the session's last resolved pick (resolving
  one on the spot when no primary has run yet). Dispatch itself goes
  through an `http.request` body overlay per attempt (mutating
  `event.model` is cosmetic — dispatch reads the persisted session
  model), which also re-resolves under a fresh exhaustion latch. It must
  live on the real driver — a standalone fake provider can never serve
  turns (dispatch stays pinned to the session model; proven by live smoke
  test). Cross-provider picks persist instead of overlaying (same
  pinning) — the session then leaves virtual mode. Under
  OpenChamber nothing is registered
- `/modelselect` chat command: with no argument it reports the global
  mode, the host + source for the session and its pick (virtual or
  persisted) via a synthetic message (steered-prompt fallback);
  `on|off|auto` writes `mode.json`. The command word is optional
  (`modelselect off` behaves like `off`)
- Host detection (`plugin/src/shared/host.js`) + session map: the
  plugin resolves OpenChamber vs standalone from the new `openchamber`
  option (`auto` default, `on`/`off` force, `open-chamber` alias) → the
  `MODELSELECT_OPENCHAMBER` env → the session map
  `.opencode/.modelselect-cache/openchamber-sessions.json`
  (`{version:1, sessions:{<sessionID>: lastSeenEpochMs}}`, fresh ≤ 30d
  entries only) → standalone; the startup log and `/modelselect` report
  the outcome. The Work Status extension is the map's sole writer (touch
  throttled to 60s per entry, 30d age prune, deleted/archived prune from
  ready `onSessions` snapshots — new `sessions` capability, extension
  0.1.4), which keeps OpenChamber detectable for sessions driven from
  the mobile app (extensions never load there, but the same
  server/project records the activity)
- Work Status shows **Agent** and **Think**: the Agent row comes from the
  live session snapshot, Think from the new `think` field in the plugin
  status file (shown capitalized, e.g. `High`). `config/task-types.yaml`
  gains a per-type `think`
  (default|minimal|low|medium|high|xhigh) reasoning-effort hint;
  `generate_model_config` publishes it into `data/model-config.json`
  (`task-types.<name>.think`), `resolveModel` returns it per pick, and
  `writeStatus` normalizes it into the status schema
  (default|minimal|low|medium|high|xhigh|null) — v1 `statusFields` and the
  v2 context hook both pass it through, with tests and a committed
  `data/model-config.json` hand-injection matching the generator output
- Mode-dependent Work Status fields: in `auto`/`off` the status file is
  stale by design (never rewritten outside `on`), so the panel now hides
  the whole pick grid (Task, Tier, Jev, Source, Think + all badges) and
  shows only the live session Model + Agent plus the mode hint. `on`
  keeps the full grid: Task, Agent, Tier, Model, Think, Jev, Source +
  badges
- Free-tier fail-soft (v2): Zen publishes no free-quota endpoint
  (anomalyco/opencode#18648), so exhaustion is detected from the real
  failed request — no dummy probe. The `http.response`/`retry` hooks
  classify free-side 402/429 (plus quota body fingerprints, mirroring
  the action's free probe) and register a latch in
  `.opencode/.modelselect-cache/free-quota.json`: while fresh, routing
  sync writes the `go` side of OpenChamber's `routing.json` (whatever
  `autoPreference` says) and `resolveModel` picks `go` (also for a
  pinned `tier: free` with a token). Spent quota uses a 12h window;
  transient rate limiting, including “Rate limit exceeded. Please try
  again later.”, uses a 1h window. The failing session flips to its
  task's go model with exactly one forced retry so the turn resumes on
  the paid alternative; each window never extends and expires after its
  first detection, then a new failure checks again. `off`/`auto`
  and `suggestOnly` still latch + resync routing but never switch. The
  Work Status view shows a `free exhausted` badge (new `freeExhausted`
  status field)

### Changed
- Plugin startup log now reports host detection and the virtual model:
  `loaded (tier=… host=<host>/<source> virtual=on|off …)` (was
  `loaded (tier=…)`)
- Plugin mode `auto` (v2 only) changed meaning: before every turn the
  plugin syncs OpenChamber's `~/.config/openchamber/routing.json` from the
  model/task caches and then acts like `off` — no task resolve, no
  announce, no status write, no model mutation — so OpenChamber's Jev
  routing owns the pick. The sync core moved out of the status bundle
  into a shared dependency-free module (`plugin/src/shared/routing.js`)
  with an fs adapter for the plugin and a host adapter for the Work
  Status bundle, which also syncs on refresh as a fallback; the panel's
  mode hint now reads `routing synced, plugin off`. v1 keeps the old
  route-until-you-switch behavior.
- Reorganized the repo around components: the select-model action now
  lives in `github-action/` with its own README (`github-action/README.md`
  holds the full inputs/outputs/probing reference); the root `action.yml`
  stays as a thin shim so `uses: dianlight/opencode-modelselect-action@v1`
  keeps working, and the root README is a general overview linking the
  three component READMEs (`github-action/`, `plugin/`,
  `openchamber-modelselect/`)
- Fixed duplicate rows in the README score table: models listed in both
  the Zen free catalog and the Go catalog (`longcat-2.5-preview-free`,
  `space-bunny-free`) appeared twice; `generate_score_reference_table`
  now dedupes with the Free tier winning, plus a regression test
- `longcat-2.5-preview-free` fallback `vision` 30→40: image input is
  confirmed by the vendor changelog and the OpenCode catalog (Inputs
  Text and Image), so the score follows the bimodal convention (~40+
  multimodal baseline, conservative — no vision benchmark published yet)
- The maintenance issue's score-research tasks now tell the agent to use
  an explicit Secondary Source Protocol instead of an open-ended web
  search: BenchLM → Artificial Analysis → Hugging Face eval-results,
  correct only when ≥2 independent sources agree, keep everything on the
  LiveBench 0–100 scale (never copy raw Terminal-Bench/SWE-bench/GPQA
  numbers 1:1), and score `vision` bimodally (5.0 text-only vs ~40+
  with a vision encoder)

### Removed
- v1 plugin entry (OpenCode 1.x): `src/v1.js` (`server()`), the
  `package.json` `main` wiring it relied on, its docs and its tests are
  gone — the package is OpenCode v2-only (`main` → `./index.js` →
  `src/v2.js`)

### Fixed
- Work Status indicator colors now use the text-safe theme tokens
  (`--success-text`/`--error-text`/`--warning-text` with the `--oc-*`
  aliases, same fallback pattern as the other panels) instead of the
  saturated `--status-success`/`--status-error`/`--status-warning`
  badges, which were unreadable against the panel background; the
  `.ms-error` fix-hint rule got the same treatment, and the muted
  `go-unknown` token stays as-is
- Corrected fallback `vision` scores in `config/model-scores.yaml` that
  claimed a vision encoder for text-only models (Hugging Face tags +
  Artificial Analysis page agree): `mimo-v2.5-pro` 55→5, `longcat-2.0`
  40→5, `laguna-s-2.1-free` 40→5, `ling-3.0-flash-free` 40→5. Also
  `longcat-2.0` instruction_following 85→90 and reasoning 85→89
  (publisher figures, dual-corroborated), `laguna-s-2.1-free` coding
  52→59 (SWE-bench Pro 59.4, three sources), and the stale AA Index
  comment on `longcat-2.0` (34→19)
- Daily maintenance now auto-verifies fallback `vision` scores against
  two secondary sources (HF model tags + AA model page, both must agree
  to flag) and surfaces mismatches as `fallback_mismatch` in
  `data/coverage_issues.json` and the maintenance issue, so the
  verification repeats every run instead of being a one-off
- OpenChamber routing sync no longer disables every category when the
  plugin's `task-types-cache.json` predates `jev_criteria` (a stale cache
  marks no type as routable, so each stored id looked stale and the sync
  wrote a routing.json with all built-ins off and none of the task-type
  categories). A payload with no criteria anywhere, or one that yields no
  category, is now skipped entirely and `routing.json` is left untouched
  until the plugin refreshes its cache
- Plugin `task-types-cache.json` is now schema-versioned (`v: 2` for the
  `jev_criteria` + `agent` shape): a cache written by older plugin code is
  rejected and refetched immediately instead of being trusted until the
  24h `configRefreshMinutes` TTL expires — trusting it left the
  OpenChamber sync with nothing routable
- Free-tier failover no longer re-selects the exhausted tier: `entry.go`
  is often itself a free model by the free-first policy, so while the
  free-quota latch is fresh the routing sync, `resolveModel`, the session
  flip and the virtual retry re-point now prefer the first paid
  (`non-free`) row of `go_ranked` (best-to-worst). Entries with no paid
  alternative keep the stored value instead of writing a free model

### Added
- Plugin session continuation: zero-signal turns (short acks like `do it`,
  `sì, procedi`, or answers after an assistant question — any language or
  length) now inherit the previous substantive turn's task instead of
  falling to `generic`. Score decides, the IT+EN ack match is only a second
  opinion; Jev sees `Previous: … / Current: …` context (+ last assistant
  snippet on v2). New `continuation` (default true) and `historyChars`
  (default 2000) options, v1 + v2, with tests
- Remote task-type list for the plugin's Jev refinement (option B): the
  maintenance run publishes `config/task-types.yaml` to
  `data/task-types.json`, and the plugin fetches it with its own parallel
  cache (`task-types-cache.json`, same `configRefreshMinutes` cadence, new
  `taskTypesUrl` option) to build the Jev `choice` criteria and validate
  answers — no more hardcoded type map in the Jev path (static list kept
  as offline fallback only). Only fetched when `jevModel` is set
- New `plugin/` dual-entry package auto-selecting the OpenCode model from
  project signals, prompt text and agent tag (v1 `server()` via `chat.message`
  in-place routing with per-session stickiness; v2 `{ id, setup }` via
  `prompt` + `context` hooks with in-place `Model.Ref` mutation and
  `switchModel` persistence). Shared heuristics (prompt 50 / files 25 / repo
  15 / agent 10, `small-model` fast-path, manual `taskType` override) and
  tier `go`/`free`/`auto` resolution reuse the central `model-config.json`,
  cached locally with `configRefreshMinutes` (default 1440 = 24h, 0 = always
  refetch). Zero dependencies, Node >= 20
- New `release-plugin` workflow publishing `plugin/` to npm as
  `opencode-modelselect-plugin` on `plugin-v*` tags (version must match
  `plugin/package.json`; requires a `NPM_TOKEN` secret), with tarball
  attached to the GitHub Release and dry-run on manual dispatch
- Plugin install docs (npm + local, v1 `plugin` tuple form vs v2 `plugins`
  object form) in the root README and `plugin/README.md`; fixed the stale
  repo intro line
- New `small-model` task type (Small Model: lightweight utility tasks —
  commit messages, session titles/renames, summaries; `instruction_following`
  priority with `speed` as secondary signal) in `config/task-types.yaml`,
  with fallback defaults, score-reference badge, README/action docs, and a
  recomputed `data/model-config.json` entry (free-first cheap-Go policy)
- New `mechanical-engineer` task type (Mechanical Engineer: calculations,
  CAD, thermodynamics, materials; `reasoning` priority) in
  `config/task-types.yaml`, with fallback defaults, score-reference badge,
  README/action docs, and a seeded `data/model-config.json` entry (next
  maintenance run recomputes it from LiveBench)
### Changed
- `opencode-maintenance` workflow now runs daily (`0 0 * * *`) instead of
  every 7 days
- Checkbox-handler Select model step now uses `tier: auto` (with
  `opencode-token` for live quota probing) and `task-type: generic`, fitting
  its research + small-config-edit workload instead of hardcoded `go`/`code`
### Fixed
- The plugin no longer needs `OPENCODE_API_KEY` in its environment: when the
  option and the env var are both empty it reads the `opencode` (Zen) key,
  then `opencode-go`, from OpenCode's auth store
  (`OPENCODE_AUTH_JSON`, else `<XDG_DATA_HOME|~/.local/share>/opencode/auth.json`
  — the file `/connect` writes). GUI hosts that spawn their own OpenCode
  server, OpenChamber in particular, never inherit the shell env, so tier
  `auto` silently degraded to `free` and Jev reported `kept:no-token` there.
  The same chain now backs the Jev call, so `jevToken` is optional as well;
  with `verbose: true` the startup log names the source
  (`token-source=auth.json:opencode`) and a keyless run logs one hint per
  process. Missing file, bad JSON or an OAuth-only entry still means no
  token, so behavior is unchanged without a key. The key is never logged or
  written to the status file
- Work Status section (`openchamber-modelselect`) renders again: the view
  referenced a `connectHost` global that does not exist in the extension
  sandbox, so the bridge was permanently null and the panel always showed
  "extension host bridge unavailable". The view is now ESM importing
  `connectHost` from `@openchamber/sdk` (pinned 2.0.2) bundled to a
  committed IIFE via `openchamber-guest-bundle`. Same fix pass corrects
  three latent read bugs that surfaced once the bridge existed:
  `readFile` resolves `{ content }` (was parsed as a raw string),
  `stat` resolves `{ kind: 'missing' }` instead of rejecting (existence is
  now read off `kind`), and `setHeight`/`storage.set` promises are no
  longer left unhandled. The installed-check also covers the OpenChamber
  managed config (`~/.config/openchamber/opencode.managed.json`, added to
  `contributes.filesystem` — re-grant file access on update). New frame
  smoke test (`openchamber-modelselect/test/`, fake guest frame speaking
  the SDK wire protocol) asserts `hello`, the per-session pick, the mode
  switch write, and the fix hint

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
- v2 plugin prompt hook now reads `event.prompt.text`
  (`PromptInput.Prompt = { text, files?, agents?, skills? }`) instead of the
  legacy string/`parts` forms, so task inference, file/agent signals and the
  chat-visible announce line fire again (old shapes kept as fallback). The
  agent tag comes from prompt mentions (the hook event has no `agent`
  field), announce edit failures log instead of vanishing silently, and
  setup logs once so loading is verifiable
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
