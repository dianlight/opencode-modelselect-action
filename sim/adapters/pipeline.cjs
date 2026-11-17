'use strict';

/**
 * Pipeline adapter: spawns a python driver per scenario. The driver imports
 * the real maintenance/benchmark script with every path constant pointed at
 * a temp dir and every network helper replayed from the scenario, runs the
 * real main(), and prints the produced files back as JSON.
 */

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function runDriver(driver, scenario, ctx) {
  const scenarioFile = path.join(ctx.world.root, 'scenario.json');
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const tmpOut = path.join(ctx.world.root, 'driver-out.json');
  const env = { ...ctx.world.env };
  if (ctx.net) env.SIM_NET_ORIGIN = ctx.net.origin;
  return new Promise((resolve) => {
    execFile('python3', [path.join(ROOT, 'sim', 'engine', driver), scenarioFile, tmpOut, ctx.world.root], { env }, (err, stdout, stderr) => {
      let payload = {};
      try { payload = JSON.parse(fs.readFileSync(tmpOut, 'utf8')); } catch { /* driver failed before writing */ }
      resolve({
        exit: err ? (err.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        driverExit: payload.exit,
        files: Object.fromEntries(Object.entries(payload.files || {}).map(([k, v]) => [`pipeline/${k}`, v])),
        fsRoot: ctx.world.root,
        calls: ctx.net ? ctx.net.calls : [],
      });
    });
  });
}

function run(scenario, ctx) {
  const driver = scenario.kind === 'benchmark' ? 'benchmark-driver.py' : 'maintenance-driver.py';
  const payload = { ...scenario };
  delete payload.world;
  if (ctx.net) payload.netOrigin = ctx.net.origin;
  return runDriver(driver, payload, ctx);
}

function verify(scenario, result) {
  const failures = [];
  const e = scenario.expect || {};
  if (e.driverExit !== undefined && result.driverExit !== e.driverExit) failures.push(`driver exit ${result.driverExit} != ${e.driverExit}`);
  for (const [rel, raw] of Object.entries(result.files || {})) {
    if (raw === null || raw === undefined) { failures.push(`pipeline output ${rel} missing`); continue; }
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (e.files && e.files[rel]) {
      const spec = e.files[rel];
      if (spec.contains && !content.includes(spec.contains)) failures.push(`${rel} missing ${JSON.stringify(spec.contains)}`);
      if (spec.notContains && content.includes(spec.notContains)) failures.push(`${rel} contains ${JSON.stringify(spec.notContains)}`);
    }
  }
  return failures;
}

module.exports = { run, verify };
