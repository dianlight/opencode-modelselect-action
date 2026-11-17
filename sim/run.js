'use strict';

/**
 * sim CLI: node sim/run.js [--component a,b] [--id substr] [--list]
 *                           [--report DIR] [--seed N]
 * Default component is everything except fuzz; `--component fuzz` runs the
 * generative invariant pack.
 */

const path = require('node:path');
const { loadScenarios, COMPONENTS } = require('./engine/loader.cjs');
const { createWorld } = require('./engine/world.cjs');
const { startNet, substituteNet } = require('./engine/net.cjs');
const { check } = require('./engine/expect.cjs');
const { Report } = require('./engine/report.cjs');
const adapters = {
  action: require('./adapters/action.cjs'),
  plugin: require('./adapters/plugin.cjs'),
  service: require('./adapters/service.cjs'),
  panel: require('./adapters/panel.cjs'),
  pipeline: require('./adapters/pipeline.cjs'),
};
const fuzz = require('./fuzz/routing-invariants.cjs');

function parseArgs(argv) {
  const args = { component: 'all', id: '', list: false, report: 'sim/report', seed: 42 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--component') args.component = argv[i += 1];
    else if (a === '--id') args.id = argv[i += 1];
    else if (a === '--list') args.list = true;
    else if (a === '--report') args.report = argv[i += 1];
    else if (a === '--seed') args.seed = Number(argv[i += 1]);
    else if (a === '--all') args.component = 'all';
    else throw new Error(`unknown arg ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = args.component === 'fuzz' ? [] : loadScenarios({ component: args.component, idFilter: args.id });
  if (args.list) {
    for (const s of scenarios) process.stdout.write(`${s.id} — ${s.title}\n`);
    if (args.component === 'fuzz' || args.component === 'all') process.stdout.write('fuzz/routing-invariants — generative invariant pack\n');
    return;
  }

  const report = new Report();
  for (const scenario of scenarios) {
    const adapter = adapters[scenario.component];
    if (!adapter) throw new Error(`${scenario.id}: no adapter for component ${scenario.component}`);
    const world = createWorld(scenario);
    const net = scenario.world?.net ? await startNet(scenario.world.net) : null;
    if (net) world.env = substituteNet(world.env, net.origin);
    const started = Date.now();
    let result;
    let error = null;
    try {
      result = await adapter.run(scenario, { world, net });
    } catch (err) {
      error = err;
      result = { exit: 1, stdout: '', stderr: String(err.stack || err), outputs: {}, calls: [], fsRoot: world.root };
    }
    const failures = [...check(scenario.expect, result), ...(adapter.verify ? adapter.verify(scenario, result) : [])];
    report.add({
      id: scenario.id,
      component: scenario.component,
      ok: failures.length === 0 && !error,
      durationMs: Date.now() - started,
      failures,
      error: error ? String(error.message) : null,
    });
    if (net) net.close();
    world.cleanup();
  }

  if (args.component === 'fuzz' || args.component === 'all') {
    const started = Date.now();
    const outcome = await fuzz.run(args.seed);
    report.add({
      id: 'fuzz/routing-invariants',
      component: 'fuzz',
      ok: outcome.failures.length === 0,
      durationMs: Date.now() - started,
      failures: outcome.failures,
      error: null,
    });
  }

  const ok = report.finish(args.report);
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

module.exports = { COMPONENTS };
