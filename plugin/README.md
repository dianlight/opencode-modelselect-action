# opencode-modelselect-plugin

Auto-select the OpenCode model from project signals, prompt text and agent tag.
One package serves both hosts: v1 follows `package.json` `main` → `src/v1.js`
(`server()`), v2 ignores `main` and loads the package root `/index.js` (the
v2 `{ id, setup }` definition).

Zero dependencies, Node >= 20.

## Install

```jsonc
// opencode.json / opencode.jsonc (v2)
{
  "plugins": [
    {
      "package": "./plugin",
      "options": {
        "taskType": "auto",       // auto = heuristics, or a fixed task-type
        "tier": "auto",           // go | free | auto
        "autoPreference": "free-first",
        "configUrl": "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json",
        "configRefreshMinutes": 1440, // 0 = refetch every request, default 24h
        "fallbackModel": "",
        "verbose": false
      }
    }
  ]
}
```

```jsonc
// v1 equivalent — key is singular "plugin"
{ "plugin": [["./plugin", { "tier": "auto", "taskType": "auto" }]] }
```

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
