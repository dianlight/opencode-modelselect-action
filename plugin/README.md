# opencode-modelselect-plugin

Auto-select the OpenCode model from project signals, prompt text and agent tag.
OpenCode v2 only: the package root `/index.js` loads the v2 `{ id, setup }`
definition (`src/v2.js`); the v1 `server()` entry was removed.

Zero dependencies, Node >= 20. Requires OpenCode v2.

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

### OpenChamber

OpenChamber runs its own OpenCode server with a managed config
(`~/.config/openchamber/opencode.managed.json`) that ignores your global
`~/.config/opencode/opencode.json` — global `plugins` entries never load in
the OpenChamber panel, and `opencode service restart` does not touch that
server. Add the plugin entry to the managed file (same object form as
above) and quit + reopen OpenChamber so its server reloads; the file may be
regenerated on updates, so re-check the entry if the plugin goes silent.
Plugin `console.log` output does not land in `opencode.log`, so verify via
the chat-visible announce line (`announce: "always"` for testing). The same
applies to `OPENCODE_API_KEY`: OpenChamber's server does not inherit your shell
env, so the plugin reads the key from OpenCode's `auth.json` instead — see
[Token resolution](#token-resolution). The startup log names the source
(`token-source=auth.json:opencode`), never the key.

## Options

```jsonc
{
  "taskType": "auto",       // auto = heuristics, or a fixed task-type (absolute override)
  "defaultTaskType": "generic", // fallback when heuristics score nothing
  "agentTaskMap": {},       // per-agent pins, e.g. { "reviewer": "review" }
  "tier": "auto",           // go | free | auto
  "autoPreference": "free-first", // or go-first (tier auto only)
  "token": "",              // tier auto + jev; falls back to OPENCODE_API_KEY, then auth.json
  "configUrl": "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/model-config.json",
  "configRefreshMinutes": 1440, // 0 = refetch every request, default 24h (also governs the task-types cache below)
  "taskTypesUrl": "https://raw.githubusercontent.com/dianlight/opencode-modelselect-action/main/data/task-types.json",
  "fallbackModel": "",      // escape hatch when nothing resolves
  "verbose": false,
  "suggestOnly": false,      // trial mode: log the pick, never switch models
  "jevModel": "",            // e.g. "jev-1.13-free": when set, Jev refines the task-type
  "jevThreshold": 0.6,       // min Jev confidence to override heuristics
  "jevEndpoint": "https://opencode.ai/zen/v1/systemone",
  "jevToken": "",             // falls back to token / OPENCODE_API_KEY / auth.json
  "continuation": true,       // zero-signal turns inherit the previous task
  "historyChars": 2000,       // max chars of previous prompt kept for continuation
  "openchamber": "auto"       // host detection: auto (detect) | on | off
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `taskType` | `auto` | `auto` infers from prompt/files/repo/agent; any task-type key pins it globally and skips inference (absolute override, kept for backward compat). |
| `defaultTaskType` | `generic` | Fallback used when the heuristics score nothing (would otherwise be `generic`). Must be a task-type key. |
| `agentTaskMap` | `{}` | Per-agent pins, e.g. `{ "reviewer": "review", "writer": "docs" }` (keys case-insensitive, values must be task-type keys; a JSON string is also accepted). A pinned agent always resolves to its type, beating prompt signals and the `small-model` fast-path. |
| `tier` | `auto` | `go`, `free`, or `auto` (token ? probe live quota : `free`). |
| `autoPreference` | `free-first` | Probe order for `tier: auto`. |
| `token` | `""` | Token for `tier: auto` probing and the Jev call; falls back to `OPENCODE_API_KEY`, then to the `opencode` / `opencode-go` key in OpenCode's `auth.json` (GUI hosts never inherit the shell env). Never logged. See [Token resolution](#token-resolution). |
| `configUrl` | (see above) | Remote central model config, cached locally. |
| `configRefreshMinutes` | `1440` | Cache validity in minutes for both the model config and the task-type list; `0` refetches every request. Stale cache survives fetch failures. |
| `taskTypesUrl` | (see above) | Remote task-type definitions (`data/task-types.json`, published from `config/task-types.yaml` by the maintenance run), cached locally as `task-types-cache.json`. Only fetched when Jev refinement is enabled (`jevModel` set): it supplies the Jev `choice` criteria and the accepted answer list. Accepts `task-types-url` as alias. |
| `fallbackModel` | `""` | Used when no model resolves; empty keeps the current session model with a logged error. |
| `verbose` | `false` | Log each selection (`task/tier/model`). |
| `suggestOnly` | `false` | Trial mode: resolve task-type/tier/model as usual but never switch models — the pick is only logged to the console as `[modelselect] (suggest-only) task=… tier=… would-select=… current=…`, even with `verbose: false`. Accepts `suggest-only` / `suggest_only` as aliases. |
| `announce` | `switch` | Chat-visible pick line (`[modelselect: task=… tier=… → provider/model jev=…]`; `→` becomes `would use` in `suggestOnly`): `switch` emits only on model change, `always` every user turn, `off` keeps console logs only. The trailing `jev=` segment tells why the task is what it is: `off` (Jev disabled), `pinned` (fixed `taskType`), `<choice>@<conf>` (Jev decided, e.g. `review@0.95`), or `kept:<reason>` (`no-token`, `error`, `lowconf`, `unknown`, `empty` — heuristic kept). Appends a terse line to the prompt (~15 tokens/turn). |
| `jevModel` | `""` | Optional Jev refinement (`jev-1.13` / `jev-1.13-free`, aliases `jev-model` / `typesafe-model`): when set, a `choice` question is POSTed to `jevEndpoint` with the prompt as state; a confident answer overrides the heuristic task-type. The choice criteria (and accepted answers) come from the remote task-type list (`taskTypesUrl`), never a hardcoded map — the static list is only an offline fallback. Empty (default) disables Jev entirely — no network call. |
| `jevThreshold` | `0.6` | Minimum Jev `confidence` (0..1) to accept the answer; below it the heuristic wins. |
| `jevEndpoint` | `https://opencode.ai/zen/v1/systemone` | SystemOne endpoint for the Jev call. |
| `jevToken` | `""` | Auth for the Jev call; falls back to `token` / `OPENCODE_API_KEY` / `auth.json`. Never logged. |
| `continuation` | `true` | Zero-signal turns (acks like `do it` / `sì, procedi`, answers after a question, any language or length) inherit the previous substantive turn's task instead of falling to `generic`. The ack match (IT+EN) is only a second opinion — the score decides. Set `false` to disable. |
| `historyChars` | `2000` | Max chars of the previous substantive prompt kept per session for continuation (also fed to Jev as `Previous: … / Current: …` context, plus the last assistant snippet). Accepts `history-chars` alias. |
| `openchamber` | `auto` | Host detection force for the virtual model and the `/modelselect` host line: `auto` detects via `MODELSELECT_OPENCHAMBER` env (`1|true|on|yes` / `0|false|off|no`), then the OpenChamber session map (below); `on` / `off` force a host. Accepts the `open-chamber` alias. See [Host detection](#host-detection-opencode-vs-standalone). |

## How it routes (verified against SDK types)

- `Model.Ref` is `{ providerID, id }`. The `context` hook mutates those
  fields in place for the in-flight turn and calls
  `ctx.session.switchModel` to persist the choice like the model picker
  does. `title`/`compaction`/`generate` requests are deliberately left
  alone so cheap auxiliary calls stay cheap.

Scores each task-type from prompt (50) + touched files (25) + repo
structure (15) + agent tag (10); highest wins, ties go to `generic`
(or `defaultTaskType` when set). `small-model` triggers (commit messages,
titles, summaries) win outright via fast-path. A zero-signal turn (short
ack, answer after a question — any language or length) inherits the
previous substantive turn's task instead of falling to `generic`
(`continuation`, on by default). Resolution order is:
fixed `taskType` (absolute, global) first, then the `agentTaskMap` pin
for the current agent tag, then fast-path, then weighted heuristics,
then continuation, then `defaultTaskType`. Prefer `agentTaskMap` +
`defaultTaskType` over a fixed `taskType` when you want per-agent
control with a safe fallback.

Tier `auto` probes the Go usage endpoint when a token is available
(see [Token resolution](#token-resolution)) and degrades to the preferred tier
instead of failing the session; without a token it uses `free`.

## Token resolution

A key is needed only for `tier: auto` (live Go-quota probe) and for Jev
refinement. One token serves both, resolved in this order:

1. the `token` option (`opencode-token` alias) — explicit always wins;
2. `OPENCODE_API_KEY` from the environment;
3. the `opencode` (Zen) key in OpenCode's auth store, then `opencode-go` —
   `OPENCODE_AUTH_JSON` when set, otherwise
   `<XDG_DATA_HOME|~/.local/share>/opencode/auth.json`, the same file
   `/connect` writes.

Step 3 exists because a GUI host does not hand your shell environment to the
OpenCode server it spawns. Under OpenChamber `OPENCODE_API_KEY` is empty, so
`tier: auto` degraded to `free` and the announce line showed
`jev=kept:no-token` even with a working key. Now the on-disk key is picked up
automatically — no config change needed. Jev uses the same chain, so
`jevToken` is optional there too.

Nothing usable (no file, bad JSON, an OAuth-only entry, or another provider's
key) simply means no token: `tier: auto` falls back to `free` and, with
`verbose: true`, logs one hint per process naming the option, the env var and
the auth store. The key is never logged, never written to the status file, and
never leaves the machine. The read is memoized, so a `/connect` mid-session is
picked up on the next OpenCode restart (or after `clearAuthCache()` in tests).

To pin a key explicitly instead — e.g. a Go-only key, or a host whose auth
store you do not want read — set it in the OpenChamber managed config along
with the plugin entry:

```jsonc
// ~/.config/openchamber/opencode.managed.json
{
  "plugins": [
    {
      "package": "opencode-modelselect-plugin",
      "options": { "tier": "auto", "token": "sk-…" }
    }
  ]
}
```

Then reopen OpenChamber so its server reloads.

The remote model config is cached under
`<project>/.opencode/.modelselect-cache/` (`model-config-cache.json`; the
Jev task-type list lives next to it as `task-types-cache.json` and follows
the same `configRefreshMinutes` cadence, but is only fetched when Jev is
enabled); `configRefreshMinutes: 0`
refetches every request, otherwise the cache is reused until it expires.
A failed refetch keeps serving stale cache; only a missing cache with an
unreachable remote throws, and even then the session keeps its current
model (the error is logged, not fatal).

## Status & mode

Each routed turn (including `suggestOnly` runs) writes a
best-effort per-session status file next to the caches — it never throws:

`<project>/.opencode/.modelselect-cache/status-<sessionID>.json`
(`sessionID` sanitized to `[A-Za-z0-9-_]`)

```jsonc
{
  "sessionID": "ses_abc123",
  "taskType": "review",
  "tier": "free",
  "model": "opencode/muse-spark-free", // "provider/id"
  "jev": "pinned",        // off | pinned | <choice>@<conf> | kept:<reason>
  "goOk": null,           // quota probe: true | false | null (no probe ran)
  "think": "high",        // task-type reasoning effort: default | minimal | low | medium | high | xhigh | null
  "freeExhausted": null,  // soft-error latch: true | false | null (quota: 12h; rate limit: 1h)
  "source": "cache",      // remote | cache | cache-stale…
  "suggestOnly": false,
  "updatedAt": 1720000000000 // epoch ms
}
```

The global mode file `<project>/.opencode/.modelselect-cache/mode.json`
(`{"mode": "on"|"off"|"auto"}`) controls routing; a missing file, bad
JSON, or unknown value falls back to the external
`~/.config/openchamber/modelselect.json` `mode` when readable and valid,
else `"auto"` (default):

```sh
echo '{"mode":"off"}' > <project>/.opencode/.modelselect-cache/mode.json
```

The external file (`~/.config/openchamber/modelselect.json`, user-editable)
holds the global defaults plus the autoset flags:

```json
{
  "mode": "auto",
  "autoSmallModel": false,
  "autoWalkthroughModel": false,
  "smallModelTask": "small-model",
  "walkthroughModelTask": "review"
}
```

Before the mode check on every turn (the `prompt` + `context` hooks) the
plugin best-effort syncs OpenChamber's `~/.config/openchamber/routing.json`
from the caches above (`src/shared/routing.js`, writes only on diff). The
write is skipped silently when `~/.config/openchamber` doesn't exist —
the plugin never creates OpenChamber's config itself.

- `on` — route every turn.
- `off` — skip routing entirely for the turn: no mutation, no
  `switchModel`, no announce line, no status write (one verbose log line
  only).
- `auto` — refresh OpenChamber's Jev routing categories
  (`~/.config/openchamber/routing.json`) from the plugin caches before the
  turn, then act like `off`: no resolve, no announce, no status write, no
  model mutation. The freshly synced categories are what route the
  question — OpenChamber's router picks the model, the plugin stays
  hands-off. This is the default.

When `autoSmallModel` is true the sync also writes the resolved
`smallModelTask` model into OpenChamber's `settings.json` +
`preferences.json` as `smallModelOverride` (with
`smallModelUseDefault: false`); when `autoWalkthroughModel` is true it
writes the resolved `walkthroughModelTask` model as
`walkthroughModelOverride` (the Settings → Sessions → Changes
Walkthrough Model row — the per-panel Walkthrough model picker defaults
to the small model, so keeping the small override fresh covers it too).
Both follow the same go/free preference (and the 12h free-exhausted
latch) as the routing categories, and both write only on diff.

## Host detection (OpenCode vs standalone)

The plugin needs to know whether its OpenCode server is serving an
OpenChamber client (web/desktop/mobile app) or a standalone session (TUI,
`opencode run`, SDK embeds). Detection order — the first decisive source
wins:

1. the `openchamber` option — `on` forces OpenChamber, `off` forces
   standalone, `auto` (default) falls through;
2. the `MODELSELECT_OPENCHAMBER` env — `1|true|on|yes` / `0|false|off|no`;
3. the session map —
   `<project>/.opencode/.modelselect-cache/openchamber-sessions.json`,
   `{version:1, sessions:{<sessionID>: lastSeenEpochMs}}`, written only by
   the Work Status extension (single writer: the extension writes, the
   plugin reads). A fresh entry (≤ 30 days old) means an OpenChamber
   client has used this project. This is the mobile-proof signal:
   extensions do not load on the mobile app, but the web/desktop session
   records its activity into the same map file (same server, same
   project);
4. otherwise — standalone.

The startup log names the outcome (`host=standalone/default`,
`host=openchamber/session-map`, …) and `/modelselect` re-reports it per
session. Detection only gates the virtual model below — per-turn routing
always keys off the session's actual model, never the host.

## Virtual model `opencode/auto` (standalone only)

When the host resolves standalone, the plugin appends an `auto` entry to
the real `opencode` provider's inventory (existing models preserved, the
entry never duplicated). Selecting it makes the session route like mode
`on` on every turn — the picker *is* the switch:

- the in-flight `event.model` is mutated to the resolved pick per turn
  (bookkeeping for logs/announce/status);
- the `http.request` overlay writes the decided model into the outgoing
  body per physical attempt — this is what actually routes, because
  dispatch reads the persisted session model and `event.model` mutation
  is cosmetic. It resolves on the spot when no pick exists yet and
  re-resolves under a fresh exhaustion latch, so armed retries carry a
  live decision too;
- `switchModel` is never called for same-provider picks, so the session
  stays on `opencode/auto` and keeps re-routing (no persist, no
  stickiness to the resolved model). Cross-provider picks cannot be
  overlaid (the endpoint stays pinned to the session model) and persist
  instead — the session then leaves virtual mode and routes normally;
- `mode.json` is bypassed — a virtual pick routes in `on`, `off` and
  `auto`;
- free-tier exhaustion arms the forced retry and re-points the retry
  event at the `go` model in place instead of flipping the session;
- `title`/`compaction`/`generate` requests follow the session's last
  resolved pick (resolving one on the spot when no primary turn has run
  yet — the raw virtual entry must never dispatch).

It must live on the real driver: OpenCode pins the dispatch endpoint to
the session model, so a standalone fake provider could never serve turns
(`package: ""` is rejected at load, a cloned real driver fails
load-time model validation). Under OpenChamber nothing is registered:
the host owns the model there, and a virtual entry would only clutter
its picker (mode `auto` hands off to OpenChamber's router instead).

Known first-turn gap: the announce line for a virtual pick starts from
turn 2 — the prompt hook runs before the context hook marks the session
(pinned by a test).

## `/modelselect` command

A chat command (registered via `ctx.command.transform`):

- `/modelselect` — status: global mode, host + source for this session,
  the session's pick (virtual or persisted), and the last routed pick
  from the status file. Output goes through a synthetic message (no
  model turn, no tokens), falling back to a steered prompt.
- `/modelselect on|off|auto` — writes the mode file (the same file the
  OpenChamber switch uses) and echoes the new mode.

The command word is optional: `modelselect off` and a bare `off` behave
the same.

## Free-tier fail-soft

Zen publishes no free-quota endpoint (upstream
[anomalyco/opencode#18648](https://github.com/anomalyco/opencode/issues/18648)
is still open), so exhaustion is detected from the real failed request —
there is deliberately no probe. When a free-side `primary` model call
comes back exhausted (402, 429, quota wording, or the transient message
“Rate limit exceeded. Please try again later.”), the plugin:

1. registers a latch in
   `<project>/.opencode/.modelselect-cache/free-quota.json` — while
   fresh, routing sync writes the `go` side of OpenChamber's
   `routing.json` (whatever `autoPreference` says) and `resolveModel`
   picks `go` (also for a pinned `tier: "free"` when a token exists).
   Spent quota uses a 12h window; transient rate limiting uses a 1h
   window;
2. forces exactly one retry of the turn on its task's `go` model — no
   dummy probe, no loop (the flip latches per session and OpenCode's
   attempt cap bounds the rest). On a virtual `modelselect/auto` session
   the flip is skipped (the session must keep re-routing): the plugin
   only arms the retry and re-points the retry event at the `go` model
   in place.

Each window runs from its first detection and never extends; after it
expires, the next real failure may register again (the "new check"). `off`/`auto` modes and `suggestOnly` still latch + resync
routing but never switch the session. The Work Status view shows a
`free exhausted` badge while the latch is fresh.

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
```

OpenCode loads the plugin at startup, so restart (or reload) OpenCode
after every code change — there is no hot reload. The package root
`/index.js` is the v2 `{ id, setup }` definition (`src/v2.js`); shared
logic lives in `src/shared/` (`detect.js` for task-type heuristics,
`select.js` for options, config cache and tier resolution, `host.js` for
host detection and the session-map read).

Suggested debug setup while developing: `verbose: true` to see each pick,
`taskType` pinned to skip inference when testing tier/config changes,
`suggestOnly: true` to trial routing without switching models, and
`configRefreshMinutes: 0` (or deleting
`<project>/.opencode/.modelselect-cache/`) to bypass the 24h config
cache. Validate with `node --check` on touched files and
`npm test` inside `plugin/` (runs `node --test test/`).

To add a new part: a new task-type starts in `config/task-types.yaml`
plus regenerated `data/model-config.json` and `data/task-types.json`
(the latter feeds the Jev `choice` criteria automatically — no plugin
change needed); a new detection signal goes
in `src/shared/detect.js` with a case in `plugin/test/plugin.test.js`; a
new option goes through `normalizeOptions` in `src/shared/select.js`
(including its aliases/defaults) plus docs in the Options table above and
tests. Keep the routing constraints verified against the SDK types:
mutate `providerID`/`id` in place, never reassign the model object; keep
stickiness per session; leave `title`/`compaction`/`generate` requests on
their own models (virtual `modelselect/auto` sessions excepted — they
never persist).
