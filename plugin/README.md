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

## Options

```jsonc
{
  "taskType": "auto",       // auto = heuristics, or a fixed task-type
  "tier": "auto",           // go | free | auto
  "autoPreference": "free-first", // or go-first (tier auto only)
  "token": "",              // tier auto only; falls back to OPENCODE_API_KEY
  "configUrl": "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json",
  "configRefreshMinutes": 1440, // 0 = refetch every request, default 24h
  "fallbackModel": "",      // escape hatch when nothing resolves
  "verbose": false
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `taskType` | `auto` | `auto` infers from prompt/files/repo/agent; any task-type key pins it and skips inference. |
| `tier` | `auto` | `go`, `free`, or `auto` (token ? probe live quota : `free`). |
| `autoPreference` | `free-first` | Probe order for `tier: auto`. |
| `token` | `""` | Token for `tier: auto` probing; falls back to `OPENCODE_API_KEY`. Never logged. |
| `configUrl` | (see above) | Remote central model config, cached locally. |
| `configRefreshMinutes` | `1440` | Cache validity in minutes; `0` refetches every request. Stale cache survives fetch failures. |
| `fallbackModel` | `""` | Used when no model resolves; empty keeps the current session model with a logged error. |
| `verbose` | `false` | Log each selection (`task/tier/model`). |

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
structure (15) + agent tag (10); highest wins, ties go to `generic`.
`small-model` triggers (commit messages, titles, summaries) win outright
via fast-path. A fixed `taskType` option skips inference entirely.

Tier `auto` probes the Go usage endpoint when a token is available
(`token` option or `OPENCODE_API_KEY`) and degrades to the preferred tier
instead of failing the session; without a token it uses `free`.

The remote model config is cached under
`<project>/.opencode/.modelselect-cache/`; `configRefreshMinutes: 0`
refetches every request, otherwise the cache is reused until it expires.
A failed refetch keeps serving stale cache; only a missing cache with an
unreachable remote throws, and even then the session keeps its current
model (the error is logged, not fatal).
