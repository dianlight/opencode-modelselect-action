# sim — component simulator

A scenario harness that boots every component of this repo at its real
process boundary with everything around it faked: spawned binaries keep
their real CLI contract, HTTP hosts are replayed from the scenario, and
file systems are throwaway sandboxes.

```bash
node sim/run.js --all                 # every component + fuzz pack
node sim/run.js --component action    # one component
node sim/run.js --id auto             # id substring filter
node sim/run.js --list                # list scenarios
node sim/run.js --seed 7              # fuzz seed (reproducible)
npm run sim                           # same as --all
```

Each run writes `sim/report/<run-id>/{results.json,junit.xml,report.html,summary.txt}`.

## Components

| component  | adapter                          | how it is simulated |
|------------|----------------------------------|---------------------|
| action     | `sim/adapters/action.cjs`        | spawns `github-action/src/index.js` with `INPUT_*` env + `GITHUB_OUTPUT` file; net mock replays usage/probe endpoints |
| plugin     | `sim/engine/plugin-runner.cjs`   | real `plugin/src/v2.js` against a fake OpenCode v2 host (hook registry, `switchModel`, `synthetic`, catalog); scenario replays prompt/context hooks |
| service    | `sim/adapters/service.cjs`       | spawns the committed `service/main.js` bundle on a loopback port with a fixture home; steps are real HTTP calls |
| panel      | `sim/adapters/panel.cjs`         | committed `panel/main.js` in a fake guest frame (vm + DOM + MessagePort) wired to the real service, exactly as the host proxies it |
| pipeline   | `sim/adapters/pipeline.cjs`      | python drivers run the real `opencode_maintenance.py` / `benchmark_models.py` with all path constants pointed at a temp dir and every network helper replayed |
| fuzz       | `sim/fuzz/routing-invariants.cjs`| seeded generative cases over the shared routing/budget core |

## Adding a scenario

Copy an existing file in `sim/scenarios/<component>/`, change `id`/`title`,
edit `world` (files + net), `env`/`seed`/`steps`/`ops` and `expect`. The
loader validates every case at start; a malformed scenario fails loudly.

## Adding coverage for a new feature

When a shipped change adds, alters, or removes observable behavior, extend the sim in the same change:

1. Pick the component directory that owns the behavior: `action`, `plugin`, `service`, `panel`, or `pipeline` (plus the fuzz pack for shared core changes under `core/`).
2. Add fixtures under `sim/fixtures/` if the scenario needs new config shapes, catalogs or task banks.
3. Add `sim/scenarios/<component>/<kebab-id>.cjs` using the scenario DSL (`world.files` / `world.net`, `env`, `seed`, `steps` / `ops`, `expect`). The loader validates strictly and stamps `__file` on each scenario for error messages.
4. Run `node sim/run.js --component <c> --id <substr>` then the full `node sim/run.js --all`; iterate to green before committing.

## Deliberate deviations from the original proposal

- Scenarios are `.cjs` data modules, not YAML: zero new dependencies and no
  new yamllint surface. Same declarative shape.
- The fuzzer is a seeded PRNG + invariant checks instead of fast-check —
  reproducible failures without a new package.
- The panel adapter uses the repo's own vm + fake-DOM technique instead of
  Playwright: deterministic, no browser download, and it exercises the same
  SDK wire protocol.

CI wiring is intentionally not added yet (per the agreed build order).
