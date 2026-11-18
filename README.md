# Opencode Modelselect

[![GitHub release](https://img.shields.io/github/v/release/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/releases)
[![GitHub last commit](https://img.shields.io/github/last-commit/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/commits/main)
[![GitHub issues](https://img.shields.io/github/issues-raw/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/pulls)
[![GitHub license](https://img.shields.io/github/license/dianlight/opencode-modelselect-action)](https://github.com/dianlight/opencode-modelselect-action/blob/main/LICENSE)

Model routing ecosystem for OpenCode: GitHub Action for CI, live plugin
for sessions, OpenChamber status view, and LiveBench-driven model ranking
from one central config (`data/model-config.json`), so model updates
propagate with no sync and no edits.

## Components

| Component | Path | Deep docs |
|-----------|------|-----------|
| Select Model Action | `github-action/` | [github-action/README.md](./github-action/README.md) |
| Modelselect Plugin | `plugin/` | [plugin/README.md](./plugin/README.md) |
| OpenChamber Extension | `openchamber-modelselect/` | [openchamber-modelselect/README.md](./openchamber-modelselect/README.md) |

- **Select Model Action** preselects the model in CI before running the
  OpenCode step (`task-type` + `tier` → `model` output). The root
  `action.yml` is a thin shim pointing at `github-action/src/index.js`, so
  `uses: dianlight/opencode-modelselect-action@v1` keeps working; the
  subpath `.../github-action@v1` resolves the same code directly. See the
  component README for inputs, outputs, `tier: auto` probing, `max-cost`
  budgets and fail-closed behavior.
- **Modelselect Plugin** routes the model live inside OpenCode sessions,
  inferring the task-type from project signals, prompt text and agent tag.
  OpenCode v2 only. See the component README for install (v2/OpenChamber),
  options, host detection, the `modelselect/auto-*` virtual models, the
  `/modelselect` command, token resolution and trial runs.
- **OpenChamber Status View** is a host-rendered Work Status section
  (`contributes.statusSection.source`, OpenChamber >= 2.6.1): the host draws
  the plugin's newest project pick plus the auto-update-router switch and a
  tier select, fed by a local service. That service is the extension's only
  owner of file I/O: the settings panel (plugin options, extension config,
  models chain) and a "Model select pick" session action both go through it,
  so the package asks for no file permissions. It also records session
  activity into the host-detection session map the plugin reads, and answers
  OpenChamber's Usage page as a quota provider. See the component README for
  install, build and test.

## Quick start

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

There are no default models: if the config is unreachable or the entry is
missing, the step fails hard unless an explicit `fallback-model` is given.

## Central config and maintenance

`data/model-config.json` is the **actual configuration**, keyed by
task-type only (`task-types.<name>.{go,free}`), consumed by every component
at startup. The maintenance script (`scripts/opencode_maintenance.py`, run
by the `opencode-maintenance` workflow) recomputes the config each run and
commits it directly; task types are defined in `config/task-types.yaml`.
To change a model: run `mise run maintenance` and review the committed
`data/model-config.json` diff — downstream workflows pick it up
automatically at their next run.

## Provider-model v2

The v1 config keeps publishing the v1 layer; the v2 layer lives in its own
files (`-v2` suffix), same data, separate concerns:

- **v1** (`data/model-config.json` `task-types.<name>`) — `go`/`free` picks
  plus the per-tier ranked lists (`go_ranked`, `free_ranked`,
  provider-agnostic `ranked`).
- **v2** (`data/model-config-v2.json` `schema_version: 2`,
  `task-types-v2.<name>.model`) — each task references **one** model id.
  `data/model-registry-v2.json` lists every model once, with its
  free/non-free provider **variants** and their costs.

At selection time the runtime (action, plugin, OpenChamber models preview)
prefers v2: it resolves task → model id → variant, ordering the variants by
the `free-first` / `go-first` preference, then cost, and on equal cost+score
it picks the engine provider (`opencode` / `opencode-go`) over an external
one. When v2 has no entry or no usable variant (provider unreachable,
latched, over budget), the reader falls back to the v1 task entries. The
v1 and v2 artifacts are written by the same maintenance run.

## Model Recommendations by Task Type

> Automatically updated by the `opencode-maintenance` workflow.

The generated tables live in their own files:

- [Model recommendations by task type](./docs/models.md) — the best Zen,
  free and Go pick per task, with LiveBench score and blended cost.
- [Provider catalog](./docs/providers.md) — every provider the routing model
  knows, its class and the models it serves.

## Sponsor

<a href="https://github.com/sponsors/dianlight"><img src="https://img.shields.io/github/sponsors/dianlight?style=flat-square&logo=githubsponsors&logoColor=%23EA4AAA" alt="Github Sponsor"></a>
<a href="https://www.buymeacoffee.com/ypKZ2I0"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=ypKZ2I0" alt="Buy Me a Coffee"/></a>

### Referral

If you're interested in subscribing to an OpenCode Go plan, [click this referral link](https://opencode.ai/go?ref=HKKSCM481M) — you'll get a $5 credit, and $5 will be donated to support this project.

## License

[MIT License](./LICENSE)