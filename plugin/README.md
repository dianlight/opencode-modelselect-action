# opencode-modelselect-plugin

Auto-select the OpenCode model from project signals, prompt text and agent tag.
One package serves both hosts: v1 follows `package.json` `main` → `src/v1.js`
(`server()`), v2 ignores `main` and loads the package root `/index.js` (the
v2 `{ id, setup }` definition).

Zero dependencies, Node >= 20. Requires OpenCode v1 >= 1.18.29
(object-form plugins) or OpenCode v2.

## Install

Get the package from npm (published by the `release-plugin` workflow on
`plugin-v*` tags) or point at a local checkout:

```sh
npm install opencode-modelselect-plugin
```

```jsonc
// opencode.json / opencode.jsonc — OpenCode v2 (key is plural "plugins")
{
  "plugins": [
    // from npm:
    "opencode-modelselect-plugin",
    // ...with options:
    // { "package": "opencode-modelselect-plugin", "options": { "tier": "auto" } },
    // ...or from a local checkout (v2 also loads .opencode/plugins/):
    // { "package": "./plugin", "options": { "tier": "auto" } }
  ]
}
```

```jsonc
// opencode.json / opencode.jsonc — OpenCode v1 (key is singular "plugin")
{
  // from npm:
  // "plugin": ["opencode-modelselect-plugin"]
  // ...with options (tuple form):
  // "plugin": [["opencode-modelselect-plugin", { "tier": "auto", "taskType": "auto" }]]
  // ...or from a local checkout (v1 loads .opencode/plugin/):
  "plugin": [["./plugin", { "tier": "auto", "taskType": "auto" }]]
}
```

Differences between v1 and v2 setup: only the config key (`plugin` vs
`plugins`, tuple vs object entry) and the local directory (`.opencode/plugin/`
vs `.opencode/plugins/`). The package itself serves both hosts with no code
changes.

### OpenChamber

OpenChamber runs its own OpenCode server with a managed config
(`~/.config/openchamber/opencode.managed.json`) that ignores your global
`~/.config/opencode/opencode.json` — global `plugins` entries never load in
the OpenChamber panel, and `opencode service restart` does not touch that
server. Add the plugin entry to the managed file (same object form as
above) and quit + reopen OpenChamber so its server reloads; the file may be
regenerated on updates, so re-check the entry if the plugin goes silent.
Plugin `console.log` output does not land in `opencode.log`, so verify via
the chat-visible announce line (`announce: "always"` for testing).

## Options

```jsonc
{
  "taskType": "auto",       // auto = heuristics, or a fixed task-type (absolute override)
  "defaultTaskType": "generic", // fallback when heuristics score nothing
  "agentTaskMap": {},       // per-agent pins, e.g. { "reviewer": "review" }
  "tier": "auto",           // go | free | auto
  "autoPreference": "free-first", // or go-first (tier auto only)
  "token": "",              // tier auto only; falls back to OPENCODE_API_KEY
  "configUrl": "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json",
  "configRefreshMinutes": 1440, // 0 = refetch every request, default 24h
  "fallbackModel": "",      // escape hatch when nothing resolves
  "verbose": false,
  "suggestOnly": false       // trial mode: log the pick, never switch models
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `taskType` | `auto` | `auto` infers from prompt/files/repo/agent; any task-type key pins it globally and skips inference (absolute override, kept for backward compat). |
| `defaultTaskType` | `generic` | Fallback used when the heuristics score nothing (would otherwise be `generic`). Must be a task-type key. |
| `agentTaskMap` | `{}` | Per-agent pins, e.g. `{ "reviewer": "review", "writer": "docs" }` (keys case-insensitive, values must be task-type keys; a JSON string is also accepted). A pinned agent always resolves to its type, beating prompt signals and the `small-model` fast-path. |
| `tier` | `auto` | `go`, `free`, or `auto` (token ? probe live quota : `free`). |
| `autoPreference` | `free-first` | Probe order for `tier: auto`. |
| `token` | `""` | Token for `tier: auto` probing; falls back to `OPENCODE_API_KEY`. Never logged. |
| `configUrl` | (see above) | Remote central model config, cached locally. |
| `configRefreshMinutes` | `1440` | Cache validity in minutes; `0` refetches every request. Stale cache survives fetch failures. |
| `fallbackModel` | `""` | Used when no model resolves; empty keeps the current session model with a logged error. |
| `verbose` | `false` | Log each selection (`task/tier/model`). |
| `suggestOnly` | `false` | Trial mode: resolve task-type/tier/model as usual but never switch models — the pick is only logged to the console as `[modelselect] (suggest-only) task=… tier=… would-select=… current=…`, even with `verbose: false`. Accepts `suggest-only` / `suggest_only` as aliases. |
| `announce` | `switch` | Chat-visible pick line (`[modelselect: task=… tier=… → provider/model]`; `→` becomes `would use` in `suggestOnly`): `switch` emits only on model change, `always` every user turn, `off` keeps console logs only. v1 pushes a zero-token `ignored:true` part; v2 appends a terse line to the prompt (~15 tokens/turn). |

## How it routes (verified against SDK types)

- v1 (`@opencode-ai/plugin` 1.18.x): `chat.params` output has no model
  field, so routing happens in `chat.message` by mutating
  `output.message.model.providerID`/`modelID` in place. The mutation lasts
  one turn, so the choice is kept sticky per session and re-applied on
  every message.
- v2 (`@opencode/plugin` 2.0.x): `Model.Ref` is `{ providerID, id }`
  (not `modelID`). The `context` hook mutates those fields in place for
  the in-flight turn and calls `ctx.session.switchModel` to persist the
  choice like the model picker does. `title`/`compaction`/`generate`
  requests are deliberately left alone so cheap auxiliary calls stay cheap.

Scores each task-type from prompt (50) + touched files (25) + repo
structure (15) + agent tag (10); highest wins, ties go to `generic`
(or `defaultTaskType` when set). `small-model` triggers (commit messages,
titles, summaries) win outright via fast-path. Resolution order is:
fixed `taskType` (absolute, global) first, then the `agentTaskMap` pin
for the current agent tag, then fast-path, then weighted heuristics,
then `defaultTaskType`. Prefer `agentTaskMap` + `defaultTaskType` over a
fixed `taskType` when you want per-agent control with a safe fallback.

Tier `auto` probes the Go usage endpoint when a token is available
(`token` option or `OPENCODE_API_KEY`) and degrades to the preferred tier
instead of failing the session; without a token it uses `free`.

The remote model config is cached under
`<project>/.opencode/.modelselect-cache/`; `configRefreshMinutes: 0`
refetches every request, otherwise the cache is reused until it expires.
A failed refetch keeps serving stale cache; only a missing cache with an
unreachable remote throws, and even then the session keeps its current
model (the error is logged, not fatal).

## Trial run without side effects

Point OpenCode at the plugin with `suggestOnly: true` and use the session
normally: every turn resolves task-type, tier and model exactly as it would
in production, but nothing is switched — the only effect is one console
line per turn:

```jsonc
// opencode.json / opencode.jsonc — OpenCode v2
{
  "plugins": [
    { "package": "./plugin", "options": { "suggestOnly": true, "tier": "auto" } }
  ]
}
```

```jsonc
// opencode.json / opencode.jsonc — OpenCode v1
{
  "plugin": [["./plugin", { "suggestOnly": true, "tier": "auto" }]]
}
```

Watch the OpenCode logs for lines like
`[modelselect] (suggest-only) task=review tier=free would-select=opencode/… current=…`.
Compare `would-select` with `current` over a few real sessions; when the
picks look right, flip `suggestOnly` back to `false` (or remove it) to let
the plugin route for real.

## Develop

Work from a live checkout — no npm publish needed. Clone this repo and
point OpenCode at the `plugin/` directory with a relative or absolute
path:

```jsonc
// OpenCode v2 (key is plural "plugins"; also loads .opencode/plugins/)
{ "plugins": [{ "package": "/abs/path/to/opencode-modelselect-action/plugin", "options": { "tier": "auto", "verbose": true } }] }
// OpenCode v1 (key is singular "plugin", tuple form; loads .opencode/plugin/)
{ "plugin": [["/abs/path/to/opencode-modelselect-action/plugin", { "tier": "auto", "verbose": true }]] }
```

OpenCode loads the plugin at startup, so restart (or reload) OpenCode
after every code change — there is no hot reload. The package serves both
hosts from one codebase: v1 follows `package.json` `main` → `src/v1.js`
(`server()`), v2 ignores `main` and loads the package root `/index.js`
(the `{ id, setup }` definition in `src/v2.js`); shared logic lives in
`src/shared/` (`detect.js` for task-type heuristics, `select.js` for
options, config cache and tier resolution).

Suggested debug setup while developing: `verbose: true` to see each pick,
`taskType` pinned to skip inference when testing tier/config changes,
`suggestOnly: true` to trial routing without switching models, and
`configRefreshMinutes: 0` (or deleting
`<project>/.opencode/.modelselect-cache/`) to bypass the 24h config
cache. Validate with `node --check` on touched files and
`npm test` inside `plugin/` (runs `node --test test/`).

To add a new part: a new task-type starts in `config/task-types.yaml`
plus a regenerated `data/model-config.json`; a new detection signal goes
in `src/shared/detect.js` with a case in `plugin/test/plugin.test.js`; a
new option goes through `normalizeOptions` in `src/shared/select.js`
(including its aliases/defaults) plus docs in the Options table above and
tests. Keep the routing constraints verified against the SDK types:
mutate `providerID`/`id` (v2) or `providerID`/`modelID` (v1) in place,
never reassign the model object; keep stickiness per session; leave
`title`/`compaction`/`generate` requests on their own models.
